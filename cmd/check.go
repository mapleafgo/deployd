// cmd/check.go
package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mapleafgo/deployd/internal/config"
	"github.com/urfave/cli/v3"
	"go.yaml.in/yaml/v3"
)

// NewCheckCommand creates the check command
func NewCheckCommand() *cli.Command {
	return &cli.Command{
		Name:  "check",
		Usage: "Validate job configuration file(s)",
		Description: `Validate job configuration file(s).

Examples:
  deployd check job.yaml          # Check a single file
  deployd check /etc/deployd/jobs # Check all files in a directory
  deployd check .                 # Check all job files in current directory`,
		ArgsUsage: "[job-file-or-directory]",
		Action: func(ctx context.Context, cmd *cli.Command) error {
			if cmd.Args().Len() == 0 {
				return fmt.Errorf("requires a job file or directory argument")
			}
			return runCheck(cmd.Args().First())
		},
	}
}

// runCheck executes the check command
func runCheck(target string) error {
	files := collectJobFiles(target)
	if len(files) == 0 {
		fmt.Println("No job configuration files found.")
		return nil
	}

	passed, failed := validateFiles(files)
	printResults(passed, failed)

	if failed > 0 {
		return fmt.Errorf("%d validation failed", failed)
	}

	return nil
}

// collectJobFiles collects job config files from target
func collectJobFiles(target string) []string {
	info, err := os.Stat(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if !info.IsDir() {
		return []string{target}
	}

	entries, err := os.ReadDir(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading directory: %v\n", err)
		os.Exit(1)
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext == ".yaml" || ext == ".yml" {
			files = append(files, filepath.Join(target, entry.Name()))
		}
	}
	return files
}

// validateFiles validates all job config files
func validateFiles(files []string) (passed, failed int) {
	fmt.Printf("Validating %d job configuration file(s)...\n\n", len(files))

	for _, file := range files {
		cfg, err := loadJobConfigFromFile(file)
		if err != nil {
			printFailure(filepath.Base(file), err.Error())
			failed++
			continue
		}

		if err := config.ValidateJobConfig(cfg); err != nil {
			printFailure(filepath.Base(file), "Validation Error: "+err.Error())
			failed++
			continue
		}

		printSuccess(filepath.Base(file), cfg)
		passed++
	}

	return passed, failed
}

// loadJobConfigFromFile loads job config from file
func loadJobConfigFromFile(filePath string) (*config.JobConfig, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var cfg config.JobConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	return &cfg, nil
}

// printSuccess prints a success message with config details
func printSuccess(name string, cfg *config.JobConfig) {
	fmt.Printf("[PASS] %s\n", name)
	fmt.Printf("  Token: %s\n", cfg.Token)
	fmt.Printf("  Workdir: %s\n", cfg.Workdir)
	fmt.Printf("  Steps: %d\n", len(cfg.Steps))
	if cfg.Timeout > 0 {
		fmt.Printf("  Timeout: %v\n", cfg.Timeout)
	}
	if cfg.Queue != "" {
		fmt.Printf("  Queue: %s\n", cfg.Queue)
	}
	if cfg.Parallel {
		fmt.Printf("  Parallel: true\n")
	}
	fmt.Println()
}

// printFailure prints a failure message
func printFailure(name, reason string) {
	fmt.Printf("[FAIL] %s\n", name)
	fmt.Printf("  Reason: %s\n\n", reason)
}

// printResults prints the validation summary
func printResults(passed, failed int) {
	fmt.Println("-------------------------------------")
	fmt.Printf("Results: %d passed, %d failed\n", passed, failed)
}
