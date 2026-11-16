module github.com/mapleafgo/deployd/tasks/examples/basic

go 1.27.3

require (
 github.com/mapleafgo/deployd/tasks v0.1.0
 go.uber.org/fx v1.24.0
 red-berry-kit/auth v0.3.0
 red-berry-kit/boot v0.2.1
 red-berry-kit/cache v0.1.0
)

replace github.com/mapleafgo/deployd/tasks => ../..
