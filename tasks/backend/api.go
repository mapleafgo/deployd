package backend

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/text/language"

	"github.com/danielgtaylor/huma/v2"
	auth "red-berry-kit/auth/backend"
	"red-berry-kit/boot/backend/query"
)

// PageInput 保留既有列表分页与查询参数；分页窗口由 boot/query 校验。
type PageInput struct {
	query.Pagination
	Q string `query:"q" maxLength:"100"`
}

// TaskPathInput 以受限 ASCII 任务名定位记录，不接受文件路径。
type TaskPathInput struct {
	Name string `path:"name" maxLength:"64"`
}

// RunPathInput 以服务端生成的运行ID定位历史及字节日志。
type RunPathInput struct {
	ID string `path:"id" maxLength:"64"`
}
type createTaskInput struct {
	Body struct {
		Name string `json:"name" minLength:"1" maxLength:"64" pattern:"^[a-zA-Z0-9][a-zA-Z0-9_-]*$"`
		TaskInput
	}
}
type updateTaskInput struct {
	TaskPathInput
	Body TaskInput
}
type taskOutput struct{ Body Task }
type runOutput struct{ Body Run }
type triggerInput struct {
	TaskPathInput
	Body struct {
		Env map[string]string `json:"env"`
	}
}
type languageKey struct{}

func english(ctx context.Context) bool { value, _ := ctx.Value(languageKey{}).(bool); return value }
func message(ctx context.Context, zh, en string) string {
	if english(ctx) {
		return en
	}
	return zh
}

// fault 永不把底层路径、命令、令牌等细节交给客户端。
func fault(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	status, code, zh, en := 500, "storageFailed", "保存或读取失败，请稍后重试；如仍失败，请提供请求编号联系维护者", "Storage operation failed. Try again later; if it persists, contact support with the request ID"
	switch {
	case errors.Is(err, errHookDenied):
		status, code, zh, en = 401, "hookDenied", "Webhook认证失败", "Webhook authentication failed"
	case errors.Is(err, errInvalid):
		status, code, zh, en = 422, "invalidTask", "任务配置无效", "Invalid task configuration"
	case errors.Is(err, errMissing):
		status, code, zh, en = 404, "notFound", "记录不存在", "Record not found"
	case errors.Is(err, errConflict):
		status, code, zh, en = 409, "conflict", "状态冲突", "State conflict"
	default:
		reportStorageFailure(ctx, err)
	}
	problem := &taskError{ErrorModel: huma.ErrorModel{Status: status, Title: http.StatusText(status), Detail: message(ctx, zh, en)}, Code: code}
	if status == 422 {
		problem.Errors = validationDetails(ctx, err)
	}
	return problem
}

type taskError struct {
	huma.ErrorModel
	Code   string            `json:"code"`
	Errors []taskErrorDetail `json:"errors,omitempty"`
}

func (e *taskError) GetStatus() int { return e.Status }
func (e *taskError) Error() string  { return e.Detail }
func isAdmin(p auth.Principal) bool {
	return p.App == "admin" && p.Source == "config" && p.ID == "admin"
}

var taskLanguages = language.NewMatcher([]language.Tag{language.SimplifiedChinese, language.English})

func languageAPI(api huma.API) huma.API {
	group := huma.NewGroup(api)
	group.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		tags, _, _ := language.ParseAcceptLanguage(ctx.Header("Accept-Language"))
		_, index, confidence := taskLanguages.Match(tags...)
		en := confidence != language.No && index == 1
		lang := "zh-CN"
		if en {
			lang = "en"
		}
		ctx.SetHeader("Content-Language", lang)
		request := context.WithValue(ctx.Context(), languageKey{}, en)
		request = context.WithValue(request, validationKey{}, &validationState{fields: map[*huma.ErrorDetail]*fieldViolation{}, started: time.Now()})
		next(huma.WithContext(ctx, request))
	})
	return taskAPI{group}
}
func requireAdmin(api huma.API) huma.API {
	group := huma.NewGroup(api)
	group.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		p, ok := auth.PrincipalFromContext(ctx.Context())
		if !ok {
			_ = huma.WriteErr(api, ctx, 401, message(ctx.Context(), "请登录", "Login required"))
			return
		}
		if !isAdmin(p) {
			_ = huma.WriteErr(api, ctx, 403, message(ctx.Context(), "无管理权限", "Administrator permission required"))
			return
		}
		ctx.SetHeader("Cache-Control", "no-store")
		next(ctx)
	})
	return group
}
func pageOf[T any](rows []T, p query.Pagination) (query.Page[T], error) {
	window, err := p.Resolve(len(rows))
	if err != nil {
		return query.Page[T]{}, errInvalid
	}
	start := int(window.Offset())
	return query.NewPage(window, rows[start:min(start+window.Size, len(rows))]), nil
}
func registerTasks(api huma.API, s *taskService, authenticator auth.Authenticator) {
	localized := languageAPI(api)
	admin := requireAdmin(localized)
	huma.Register(admin, huma.Operation{OperationID: "list-tasks", Method: "GET", Path: "/api/tasks"}, func(ctx context.Context, in *PageInput) (*struct{ Body query.Page[Task] }, error) {
		rows := []Task{}
		for _, task := range s.listTasks() {
			if in.Q == "" || strings.Contains(strings.ToLower(task.Name+" "+task.Description), strings.ToLower(in.Q)) {
				rows = append(rows, task)
			}
		}
		page, err := pageOf(rows, in.Pagination)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &struct{ Body query.Page[Task] }{page}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "create-task", Method: "POST", Path: "/api/tasks", DefaultStatus: 201}, func(ctx context.Context, in *createTaskInput) (*taskOutput, error) {
		task, err := s.save(in.Body.Name, in.Body.TaskInput, true)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &taskOutput{task}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "get-task", Method: "GET", Path: "/api/tasks/{name}"}, func(ctx context.Context, in *TaskPathInput) (*taskOutput, error) {
		task, err := s.getTask(in.Name)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &taskOutput{task}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "update-task", Method: "PUT", Path: "/api/tasks/{name}"}, func(ctx context.Context, in *updateTaskInput) (*taskOutput, error) {
		task, err := s.save(in.Name, in.Body, false)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &taskOutput{task}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "delete-task", Method: "DELETE", Path: "/api/tasks/{name}"}, func(ctx context.Context, in *TaskPathInput) (*struct{}, error) {
		return nil, fault(ctx, s.remove(in.Name))
	})
	huma.Register(admin, huma.Operation{OperationID: "trigger-task", Method: "POST", Path: "/api/tasks/{name}/runs", DefaultStatus: 202}, func(ctx context.Context, in *triggerInput) (*runOutput, error) {
		run, err := s.trigger(in.Name, in.Body.Env)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &runOutput{run}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "list-runs", Method: "GET", Path: "/api/runs"}, func(ctx context.Context, in *struct {
		PageInput
		Name string `query:"name" maxLength:"64"`
	}) (*struct{ Body query.Page[Run] }, error) {
		all, err := s.readRuns()
		if err != nil {
			return nil, fault(ctx, err)
		}
		rows := []Run{}
		for _, run := range all {
			if (in.Name == "" || run.TaskName == in.Name) && (in.Q == "" || strings.Contains(strings.ToLower(run.TaskName), strings.ToLower(in.Q))) {
				rows = append(rows, run)
			}
		}
		page, err := pageOf(rows, in.Pagination)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &struct{ Body query.Page[Run] }{page}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "get-run", Method: "GET", Path: "/api/runs/{id}"}, func(ctx context.Context, in *RunPathInput) (*runOutput, error) {
		run, err := s.getRun(in.ID)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &runOutput{run}, nil
	})
	huma.Register(admin, huma.Operation{OperationID: "cancel-run", Method: "POST", Path: "/api/runs/{id}/cancel"}, func(ctx context.Context, in *RunPathInput) (*struct{}, error) {
		return nil, fault(ctx, s.cancel(in.ID))
	})
	registerLogStream(admin, s, authenticator)
	for _, route := range []struct{ path, id string }{{"/api/hooks/{name}", "hook"}, {"/hook/{name}", "legacy-hook"}} {
		for _, method := range []string{"GET", "POST"} {
			huma.Register(localized, huma.Operation{OperationID: strings.ToLower(method) + "-" + route.id, Method: method, Path: route.path, DefaultStatus: 202, Middlewares: huma.Middlewares{func(ctx huma.Context, next func(huma.Context)) { ctx.SetHeader("Cache-Control", "no-store"); next(ctx) }}}, func(ctx context.Context, in *hookInput) (*runOutput, error) {
				token := in.HookToken
				if token == "" {
					token = in.Token
				}
				run, err := s.triggerHook(in.Name, in.Env, token)
				if err != nil {
					return nil, fault(ctx, err)
				}
				return &runOutput{run}, nil
			})
		}
	}
}

type hookInput struct {
	TaskPathInput
	Token     string            `query:"token"`
	HookToken string            `header:"X-Hook-Token"`
	Env       map[string]string `json:"-"`
}

func (in *hookInput) Resolve(ctx huma.Context) []error {
	in.Env = map[string]string{}
	url := ctx.URL()
	for key, values := range url.Query() {
		if key != "token" && len(values) > 0 {
			in.Env[key] = values[0]
		}
	}
	return nil
}
