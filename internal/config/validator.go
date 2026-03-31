// internal/config/validator.go
package config

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// ValidateJobConfig 验证任务配置的完整性和合法性
func ValidateJobConfig(cfg *JobConfig) error {
	// 1. 验证必填字段
	if cfg.Token == "" {
		return fmt.Errorf("invalid config: 'token' is required")
	}
	if cfg.Workdir == "" {
		return fmt.Errorf("invalid config: 'workdir' is required")
	}
	if len(cfg.Steps) == 0 {
		return fmt.Errorf("invalid config: 'steps' is required and must not be empty")
	}

	// 2. 验证队列策略
	if cfg.Queue != "" && cfg.Queue != "wait" && cfg.Queue != "terminate" {
		return fmt.Errorf("invalid config: 'queue' must be either 'wait' or 'terminate', got '%s'", cfg.Queue)
	}

	// 3. 验证超时时间（最小 1 秒，最大 24 小时）
	if cfg.Timeout < 0 {
		return fmt.Errorf("invalid config: 'timeout' must be positive, got %v", cfg.Timeout)
	}
	if cfg.Timeout > 24*time.Hour {
		return fmt.Errorf("invalid config: 'timeout' must not exceed 24h, got %v", cfg.Timeout)
	}

	// 4. 验证工作目录路径
	if filepath.IsAbs(cfg.Workdir) == false {
		return fmt.Errorf("invalid config: 'workdir' must be an absolute path, got '%s'", cfg.Workdir)
	}

	// 5. 验证环境变量名格式
	if err := validateEnvVars(cfg.Env, "job level"); err != nil {
		return err
	}

	// 6. 验证每个步骤
	for stepIdx, step := range cfg.Steps {
		if err := validateStepConfig(step, stepIdx); err != nil {
			return err
		}
	}

	return nil
}

// validateStepConfig 验证步骤配置
func validateStepConfig(step StepConfig, stepIdx int) error {
	stepPrefix := fmt.Sprintf("step[%d]", stepIdx)

	// 1. 验证步骤名称
	if step.Name == "" {
		return fmt.Errorf("invalid config: %s 'name' is required", stepPrefix)
	}

	// 2. 验证步骤名称格式（只能包含字母、数字、下划线、连字符）
	if !isValidStepName(step.Name) {
		return fmt.Errorf("invalid config: %s 'name' must contain only alphanumeric characters, underscores or hyphens, got '%s'", stepPrefix, step.Name)
	}

	// 3. 验证命令列表
	if len(step.Commands) == 0 {
		return fmt.Errorf("invalid config: %s 'commands' is required and must not be empty", stepPrefix)
	}

	// 4. 验证命令不为空
	for cmdIdx, cmd := range step.Commands {
		if strings.TrimSpace(cmd) == "" {
			return fmt.Errorf("invalid config: %s command[%d] is empty", stepPrefix, cmdIdx)
		}
	}

	// 5. 验证工作目录路径（如果指定）
	if step.Workdir != "" && filepath.IsAbs(step.Workdir) == false {
		return fmt.Errorf("invalid config: %s 'workdir' must be an absolute path, got '%s'", stepPrefix, step.Workdir)
	}

	// 6. 验证环境变量名格式
	if err := validateEnvVars(step.Env, stepPrefix); err != nil {
		return err
	}

	return nil
}

// validateEnvVars 验证环境变量名格式
func validateEnvVars(env map[string]string, prefix string) error {
	for key := range env {
		// 环境变量名必须符合 POSIX 标准：以字母或下划线开头，只能包含字母、数字和下划线
		if !isValidEnvVarName(key) {
			return fmt.Errorf("invalid config: %s invalid environment variable name '%s' (must start with letter or underscore, contain only letters, digits and underscores)", prefix, key)
		}
	}
	return nil
}

// isValidStepName 检查步骤名称是否合法
func isValidStepName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if !isAlphanumeric(r) && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

// isValidEnvVarName 检查环境变量名是否合法（POSIX 标准）
func isValidEnvVarName(name string) bool {
	if name == "" {
		return false
	}

	// 第一个字符必须是字母或下划线
	first := name[0]
	if !isLetter(rune(first)) && first != '_' {
		return false
	}

	// 后续字符可以是字母、数字或下划线
	for i := 1; i < len(name); i++ {
		r := name[i]
		if !isAlphanumeric(rune(r)) && r != '_' {
			return false
		}
	}

	return true
}

// isLetter 检查是否是字母
func isLetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// isAlphanumeric 检查是否是字母或数字
func isAlphanumeric(r rune) bool {
	return isLetter(r) || (r >= '0' && r <= '9')
}
