package main

import (
	generated "github.com/mapleafgo/deployd/.redberry/backend"
	"red-berry-kit/boot/backend/app"
)

func options() app.Options {
	return generated.Options
}
