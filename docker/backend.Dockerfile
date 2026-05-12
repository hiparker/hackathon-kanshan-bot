FROM golang:1.22-bookworm AS builder

WORKDIR /src/services/kanshan-server

ENV GOPROXY=https://goproxy.cn,direct
ENV GOSUMDB=sum.golang.google.cn

COPY services/kanshan-server/go.mod services/kanshan-server/go.sum ./
RUN go mod download

COPY services/kanshan-server ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/kanshan-server ./cmd/server

FROM alpine:3.20 AS runtime

RUN mkdir -p /data/kanshan-sql

WORKDIR /app
COPY --from=builder /out/kanshan-server /app/kanshan-server

ENV PORT=8787
ENV DB_PATH=/data/kanshan-sql/kanshan.db
ENV LOG_LEVEL=info
ENV KANSHAN_DEBUG_MODE=false

EXPOSE 8787
VOLUME ["/data/kanshan-sql"]

CMD ["/app/kanshan-server"]
