SHELL := /bin/bash

BIN := bin/kanshan-server
CMD := ./cmd/server

.PHONY: tidy run build test fmt vet migrate clean

tidy:
	go mod tidy

run:
	go run $(CMD)

build:
	mkdir -p bin
	go build -o $(BIN) $(CMD)

test:
	go test ./...

fmt:
	gofmt -s -w .

vet:
	go vet ./...

migrate:
	go run $(CMD) -migrate-only

clean:
	rm -rf bin
	rm -f *.db *.db-journal *.db-shm *.db-wal
