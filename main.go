package main

import (
	"context"
	"fmt"
	"os"

	"github.com/mapleafgo/deployd/cmd"
	"github.com/urfave/cli/v3"
)

func main() {
	app := &cli.Command{
		Name:  "deployd",
		Usage: "A webhook-triggered command execution service",
		Description: `deployd is a lightweight command execution service triggered by webhooks.

Features:
- Webhook-triggered job execution via HTTP GET requests
- YAML-based job configuration with environment variable support
- Token authentication for both webhook triggers and admin API
- Queue management: wait (enqueue) or terminate (cancel running job)
- Serial or parallel step execution modes
- Timeout control for job execution
- Comprehensive logging with per-job log files
- RESTful API for job management`,
		Commands: []*cli.Command{
			cmd.NewServeCommand(),
			cmd.NewCheckCommand(),
		},
	}

	if err := app.Run(context.Background(), os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
