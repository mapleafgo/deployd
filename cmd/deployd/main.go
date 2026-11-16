package main

import (
	"context"
	"fmt"
	"os"
	"red-berry-kit/boot/backend/app"
)

func main() {
	if err := app.New(options()).Run(context.Background(), os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
