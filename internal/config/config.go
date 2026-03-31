// internal/config/config.go
package config

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/viper"
	"go.yaml.in/yaml/v3"
)

// Config 全局配置
type Config struct {
	Token     string `mapstructure:"token" yaml:"token"`
	Port      int    `mapstructure:"port" yaml:"port"`
	ConfigDir string `mapstructure:"config_dir" yaml:"config_dir"`
	LogDir    string `mapstructure:"log_dir" yaml:"log_dir"`
}

// JobConfig 任务配置
type JobConfig struct {
	Token    string            `mapstructure:"token" yaml:"token"`
	Workdir  string            `mapstructure:"workdir" yaml:"workdir"`
	Timeout  time.Duration     `mapstructure:"timeout" yaml:"timeout"`
	Queue    string            `mapstructure:"queue" yaml:"queue"`       // wait / terminate
	Parallel bool              `mapstructure:"parallel" yaml:"parallel"` // false(串行) / true(并行)
	Env      map[string]string `mapstructure:"env" yaml:"env"`
	Steps    []StepConfig      `mapstructure:"steps" yaml:"steps"`
}

// StepConfig 步骤配置
type StepConfig struct {
	Name     string            `mapstructure:"name" yaml:"name"`
	Workdir  string            `mapstructure:"workdir" yaml:"workdir"`
	Commands []string          `mapstructure:"commands" yaml:"commands"`
	Env      map[string]string `mapstructure:"env" yaml:"env"`
}

// Load 加载全局配置
func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	// 默认值
	v.SetDefault("port", 8080)
	v.SetDefault("config_dir", "/etc/deployd/jobs")
	v.SetDefault("log_dir", "/var/log/deployd")

	if err := v.ReadInConfig(); err != nil {
		return nil, err
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// findConfigFile 在配置目录中查找任务配置文件（支持 .yaml 和 .yml）
func findConfigFile(configDir, name string) (string, []byte, error) {
	extensions := []string{".yaml", ".yml"}

	for _, ext := range extensions {
		path := filepath.Join(configDir, name+ext)
		data, err := os.ReadFile(path)
		if err == nil {
			return path, data, nil
		}
	}

	// 所有扩展名都尝试失败，返回友好的错误信息
	return "", nil, fmt.Errorf("config file not found: tried %s.yaml and %s.yml in %s", name, name, configDir)
}

// LoadJob 加载任务配置
func LoadJob(configDir, name string) (*JobConfig, error) {
	// 查找并读取配置文件
	_, data, err := findConfigFile(configDir, name)
	if err != nil {
		return nil, err
	}

	// 解析 YAML
	var cfg JobConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// 验证配置的完整性和合法性
	if err := ValidateJobConfig(&cfg); err != nil {
		return nil, err
	}

	// 设置默认值
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Minute
	}
	if cfg.Queue == "" {
		cfg.Queue = "wait"
	}

	return &cfg, nil
}

// GetEnvWhitelist 获取环境变量白名单
func (j *JobConfig) GetEnvWhitelist() map[string]string {
	whitelist := make(map[string]string)

	// 全局环境变量
	maps.Copy(whitelist, j.Env)

	// 步骤环境变量
	for _, step := range j.Steps {
		maps.Copy(whitelist, step.Env)
	}

	return whitelist
}

// FilterEnv 过滤环境变量，只保留白名单中的
func (j *JobConfig) FilterEnv(input map[string]string) map[string]string {
	whitelist := j.GetEnvWhitelist()
	result := make(map[string]string)

	for k, v := range input {
		if _, ok := whitelist[k]; ok {
			result[k] = v
		}
	}

	return result
}

// MergeEnv 合并步骤环境变量与全局环境变量
func (j *JobConfig) MergeEnv(stepEnv map[string]string) map[string]string {
	result := make(map[string]string)

	// 全局环境变量
	maps.Copy(result, j.Env)

	// 步骤环境变量（覆盖同名）
	maps.Copy(result, stepEnv)

	return result
}
