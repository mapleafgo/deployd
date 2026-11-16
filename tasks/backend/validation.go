package backend

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
)

// fieldViolation 只保留可公开的字段位置和规则身份，不保留用户原值。
type fieldViolation struct{ Location, Code string }

func fieldError(location, code string) *fieldViolation { return &fieldViolation{location, code} }
func (e *fieldViolation) Error() string {
	return e.Location + ": " + fieldMessage(context.Background(), e.Code)
}
func (e *fieldViolation) Is(target error) bool { return target == errInvalid }

var fieldMessages = map[string][2]string{
	"timeoutRange":      {"请输入1秒至24小时的有效时长，例如30m", "Enter a duration from 1 second to 24 hours, for example 30m"},
	"absoluteWorkdir":   {"请输入绝对工作目录路径", "Enter an absolute working directory path"},
	"workdirTooLong":    {"工作目录路径不得超过4096字节", "Keep the working directory path within 4096 bytes"},
	"noNul":             {"请移除空字符（NUL）", "Remove null (NUL) characters"},
	"shellEnvReserved":  {"此变量由Bash执行环境保留，请使用其他名称", "This variable is reserved by the Bash execution environment; use another name"},
	"envName":           {"环境变量名须以字母或下划线开头，且仅含字母、数字或下划线", "Use an environment variable name starting with a letter or underscore and containing only letters, digits or underscores"},
	"nonBlank":          {"请输入非空白内容", "Enter a value that is not blank"},
	"taskName":          {"名称须为1–64位字母、数字、下划线或连字符，且以字母或数字开头", "Use 1–64 letters, digits, underscores or hyphens, starting with a letter or digit"},
	"descriptionLength": {"说明不得超过500个字符", "Keep the description within 500 characters"},
	"stepNameLength":    {"步骤名称须为1–100个字符", "Use a step name of 1–100 characters"},
	"stepsCount":        {"请提供1–100个步骤", "Provide 1–100 steps"},
	"commandsCount":     {"每个步骤须提供1–100个命令", "Provide 1–100 commands per step"},
	"queuePolicy":       {"请选择wait或terminate调度策略", "Choose the wait or terminate queue policy"},
	"requiredField":     {"请填写此必填字段", "Provide this required field"},
	"invalidField":      {"请检查字段类型、范围及格式", "Check the field type, range and format"},
}

func fieldMessage(ctx context.Context, code string) string {
	text, ok := fieldMessages[code]
	if !ok {
		text = fieldMessages["invalidField"]
	}
	return message(ctx, text[0], text[1])
}

// HTTP 的结构约束由 Huma Schema 负责；直接调用和持久记录校验仍执行全部规则。
func taskViolations(in TaskInput, structure bool) []*fieldViolation {
	out := []*fieldViolation{}
	add := func(location, code string) { out = append(out, fieldError(location, code)) }
	duration, err := time.ParseDuration(in.Timeout)
	if err != nil || duration < time.Second || duration > 24*time.Hour {
		add("body.timeout", "timeoutRange")
	}
	workdir := func(location, value string, required bool) {
		if (value != "" || required) && !filepath.IsAbs(value) {
			add(location, "absoluteWorkdir")
		}
		if len(value) > 4096 {
			add(location, "workdirTooLong")
		}
		if strings.ContainsRune(value, 0) {
			add(location, "noNul")
		}
	}
	env := func(location string, values map[string]string) {
		keys := make([]string, 0, len(values))
		for key := range values {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			valid := envNamePattern.MatchString(key)
			if reservedShellEnv(key) {
				field := location
				if valid {
					field += "." + key
				}
				add(field, "shellEnvReserved")
			}
			if !valid {
				add(location, "envName")
			}
			if strings.ContainsRune(values[key], 0) {
				field := location
				if valid {
					field += "." + key
				}
				add(field, "noNul")
			}
		}
	}
	workdir("body.workdir", in.Workdir, structure)
	env("body.env", in.Env)
	if structure {
		if utf8.RuneCountInString(in.Description) > 500 {
			add("body.description", "descriptionLength")
		}
		if in.SchedulingPolicy != "wait" && in.SchedulingPolicy != "terminate" {
			add("body.queue", "queuePolicy")
		}
		if len(in.Steps) == 0 || len(in.Steps) > 100 {
			add("body.steps", "stepsCount")
		}
	}
	for index, step := range in.Steps {
		prefix := fmt.Sprintf("body.steps[%d]", index)
		if strings.TrimSpace(step.Name) == "" && (structure || step.Name != "") {
			add(prefix+".name", "nonBlank")
		}
		if structure && utf8.RuneCountInString(step.Name) > 100 {
			add(prefix+".name", "stepNameLength")
		}
		workdir(prefix+".workdir", step.Workdir, false)
		env(prefix+".env", step.Env)
		if structure && (len(step.Commands) == 0 || len(step.Commands) > 100) {
			add(prefix+".commands", "commandsCount")
		}
		for i, command := range step.Commands {
			location := fmt.Sprintf("%s.commands[%d]", prefix, i)
			if strings.TrimSpace(command) == "" {
				add(location, "nonBlank")
			}
			if strings.ContainsRune(command, 0) {
				add(location, "noNul")
			}
		}
	}
	return out
}

// 覆盖变量只检查原有NUL约束；未知变量仍按既有规则忽略，不扩展白名单。
// 字段来源由调用入口传入，服务直接调用同样保留可纠正的原因。
func validateOverrides(overrides map[string]string, location string) error {
	keys := make([]string, 0, len(overrides))
	for key := range overrides {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var errs []error
	for _, key := range keys {
		if reservedShellEnv(key) {
			field := location
			if envNamePattern.MatchString(key) {
				field += "." + key
			}
			errs = append(errs, fieldError(field, "shellEnvReserved"))
		}
		if strings.ContainsRune(overrides[key], 0) {
			field := location
			if envNamePattern.MatchString(key) {
				field += "." + key
			}
			errs = append(errs, fieldError(field, "noNul"))
		}
	}
	return errors.Join(errs...)
}

func validateTask(in TaskInput) error {
	fields := taskViolations(in, true)
	errs := make([]error, 0, len(fields))
	for _, field := range fields {
		errs = append(errs, field)
	}
	return errors.Join(errs...)
}

// 旧任务允许保留原有的合法 Bash 保留变量声明；执行器仍会过滤其值。
// 其余格式、结构与内容校验不变，新增和更新仍使用 validateTask。
func validatePersistedTask(in TaskInput) error {
	fields := taskViolations(in, true)
	errs := make([]error, 0, len(fields))
	for _, field := range fields {
		if field.Code != "shellEnvReserved" {
			errs = append(errs, field)
		}
	}
	return errors.Join(errs...)
}

func validationDetails(ctx context.Context, err error) []taskErrorDetail {
	if err == nil {
		return nil
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		out := []taskErrorDetail{}
		for _, child := range joined.Unwrap() {
			out = append(out, validationDetails(ctx, child)...)
		}
		return out
	}
	var field *fieldViolation
	if errors.As(err, &field) {
		return []taskErrorDetail{{Location: field.Location, Code: field.Code, Message: fieldMessage(ctx, field.Code)}}
	}
	return nil
}

// Huma 2.40 的 ErrorDetail 无扩展字段，NewError 保留 ErrorDetailer 返回的指针。
// 此映射只随当前请求存活：Resolver 追加、Transform 读取，不保存输入、不跨请求共享。
type validationKey struct{}
type validationState struct {
	fields  map[*huma.ErrorDetail]*fieldViolation
	started time.Time
}

func resolveTask(ctx huma.Context, in TaskInput) []error {
	fields := taskViolations(in, false)
	state, _ := ctx.Context().Value(validationKey{}).(*validationState)
	out := make([]error, 0, len(fields))
	for _, field := range fields {
		detail := &huma.ErrorDetail{Location: field.Location, Message: fieldMessage(ctx.Context(), field.Code)}
		if state != nil {
			state.fields[detail] = field
		}
		out = append(out, detail)
	}
	return out
}
func (in *createTaskInput) Resolve(ctx huma.Context) []error {
	return resolveTask(ctx, in.Body.TaskInput)
}
func (in *updateTaskInput) Resolve(ctx huma.Context) []error { return resolveTask(ctx, in.Body) }

type taskErrorDetail struct {
	Location string `json:"location,omitempty"`
	Message  string `json:"message"`
	Code     string `json:"code"`
}

// 先转换，再交给父 API 的 Transform，避免 schema-link 包装遮蔽 ErrorModel。
// 不替换全局 Huma 错误工厂，也不截获其他模块的错误。
type taskAPI struct{ *huma.Group }

func (api taskAPI) Transform(ctx huma.Context, status string, value any) (any, error) {
	if problem, ok := value.(*huma.ErrorModel); ok && (problem.Status == 400 || problem.Status == 422) {
		converted := &taskError{ErrorModel: *problem, Code: "invalidTask"}
		converted.Title = message(ctx.Context(), "输入校验失败", "Input validation failed")
		converted.Detail = message(ctx.Context(), "请修改以下字段后重试", "Correct the following fields and try again")
		converted.ErrorModel.Errors = nil
		state, _ := ctx.Context().Value(validationKey{}).(*validationState)
		schemaCodes := map[string]map[string]bool{}
		for _, detail := range problem.Errors {
			if detail == nil {
				continue
			}
			if state == nil || state.fields[detail] == nil {
				location, code := schemaField(detail)
				if schemaCodes[location] == nil {
					schemaCodes[location] = map[string]bool{}
				}
				schemaCodes[location][code] = true
			}
		}
		seenDetails := map[[2]string]bool{}
		appendDetail := func(detail taskErrorDetail) {
			identity := [2]string{detail.Location, detail.Code}
			if !seenDetails[identity] {
				seenDetails[identity] = true
				converted.Errors = append(converted.Errors, detail)
			}
		}
		for _, detail := range problem.Errors {
			if detail == nil {
				continue
			}
			var field *fieldViolation
			if state != nil {
				field = state.fields[detail]
			}
			if field != nil {
				// 同一规则不重复；类型错误产生的零值也不再补报语义错。
				// 不同规则即使位于同一字段仍全部保留，例如路径过长且含NUL。
				if codes := schemaCodes[field.Location]; codes[field.Code] || codes["invalidField"] {
					continue
				}
				appendDetail(taskErrorDetail{Location: field.Location, Code: field.Code, Message: fieldMessage(ctx.Context(), field.Code)})
			} else {
				location, code := schemaField(detail)
				appendDetail(taskErrorDetail{Location: location, Code: code, Message: fieldMessage(ctx.Context(), code)})
			}
		}
		if len(converted.Errors) == 0 {
			converted.Errors = []taskErrorDetail{{Location: "body", Code: "invalidField", Message: fieldMessage(ctx.Context(), "invalidField")}}
		}
		value = converted
	}
	return api.Group.Transform(ctx, status, value)
}

var safeFieldPath = regexp.MustCompile(`^(body(\.(name|description|workdir|timeout|queue|parallel|env|steps)|\.steps\[[0-9]+\](\.(name|workdir|env|commands)(\[[0-9]+\])?)?)?|path\.(name|id)|query\.(page|size|q|name|offset)|header\.Last-Event-ID)$`)

func safeLocation(location string) string {
	if index := strings.Index(location, ".env."); index >= 0 {
		parent, key := location[:index+4], location[index+5:]
		if safeFieldPath.MatchString(parent) {
			if envNamePattern.MatchString(key) {
				return parent + "." + key
			}
			return parent
		}
	}
	if safeFieldPath.MatchString(location) {
		return location
	}
	return "body"
}
func schemaField(detail *huma.ErrorDetail) (string, string) {
	location := safeLocation(detail.Location)
	code := "invalidField"
	// 必填字段名来自已声明的 Schema；只接受公开类型上的静态字段名。
	const prefix = "expected required property "
	if strings.HasPrefix(detail.Message, prefix) && strings.HasSuffix(detail.Message, " to be present") {
		field := strings.TrimSuffix(strings.TrimPrefix(detail.Message, prefix), " to be present")
		switch field {
		case "name", "description", "workdir", "timeout", "queue", "parallel", "env", "steps", "commands":
			location += "." + field
			code = "requiredField"
		}
	}
	if code == "requiredField" {
		return location, code
	}
	length := strings.HasPrefix(detail.Message, "expected length ")
	items := strings.HasPrefix(detail.Message, "expected array length ")
	switch {
	case location == "body.name" && (length || strings.HasPrefix(detail.Message, "expected string to match pattern ")):
		code = "taskName"
	case (location == "body.workdir" || strings.HasSuffix(location, ".workdir")) && detail.Message == "expected length <= 4096":
		code = "workdirTooLong"
	case location == "body.description" && length:
		code = "descriptionLength"
	case location == "body.queue" && strings.HasPrefix(detail.Message, "expected value to be one of "):
		code = "queuePolicy"
	case location == "body.steps" && items:
		code = "stepsCount"
	case strings.HasSuffix(location, ".commands") && items:
		code = "commandsCount"
	case strings.HasPrefix(location, "body.steps[") && strings.HasSuffix(location, ".name") && length:
		code = "stepNameLength"
	case detail.Message == "expected length >= 1":
		code = "requiredField"
	}
	return location, code
}
