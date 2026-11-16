// 本程序仅供前端定向回归以当前 Go 标准库做差分 oracle，不访问应用数据。
package main

import (
	"encoding/json"
	"os"
	"strconv"
	"time"
)

func main() {
	var inputs []string
	if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil {
		panic(err)
	}
	results := make([]*string, len(inputs))
	for i, input := range inputs {
		if duration, err := time.ParseDuration(input); err == nil {
			value := strconv.FormatInt(int64(duration), 10)
			results[i] = &value
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		panic(err)
	}
}
