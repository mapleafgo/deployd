package backend

import "go.uber.org/fx"

// Module 装配项目业务；添加业务后在此注册构造器。
var Module = fx.Module("github.com/mapleafgo/deployd", fx.Options())
