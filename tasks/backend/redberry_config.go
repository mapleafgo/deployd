package backend

import (
	"errors"
	"strings"
)

// Config 声明任务文件目录；运行数据格式兼容已有 tasks/runs 文件。
type Config struct {
	DataDir string `json:"data_dir" default:"data/deployd" minLength:"1"`
}

// Validate 仅检查配置语义，不获取目录锁或启动后台任务。
func (c Config) Validate() error {
	if c.DataDir == "" || strings.TrimSpace(c.DataDir) != c.DataDir {
		return errors.New("data_dir: 目录不能为空或含首尾空白")
	}
	return nil
}
