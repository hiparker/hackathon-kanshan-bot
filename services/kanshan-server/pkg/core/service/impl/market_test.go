package impl

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMarketSnapshotAggregatesAndOrdersQuotes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/weather/Beijing":
			fmt.Fprint(w, `{"current_condition":[{"temp_C":"28","FeelsLikeC":"30","humidity":"70","weatherDesc":[{"value":"多云"}]}]}`)
		case "/crypto":
			fmt.Fprint(w, `{"bitcoin":{"usd":64000,"usd_24h_change":1.25},"ethereum":{"usd":3200.5,"usd_24h_change":-2.5}}`)
		case "/gold":
			fmt.Fprint(w, `{"currency":"USD","price":2360.50}`)
		case "/index":
			fmt.Fprint(w, strings.Join([]string{
				`var hq_str_s_sh000001="name,3100.11,10.10,0.33";`,
				`var hq_str_s_sz399001="name,9900.22,-20.20,-0.20";`,
				`var hq_str_int_nasdaq="name,18000.33,100.10,0.56";`,
				`var hq_str_int_hangseng="name,19000.44,-50.50,-0.27";`,
			}, "\n"))
		case "/news/daily":
			fmt.Fprint(w, `{"status":"200","data":[{"title":"腾讯新闻1","url":"https://example.com/t1","content":"腾讯内容1","source":"tenxunwang","publish_time":"2026-05-12 14:00:00"},{"title":"腾讯新闻2","url":"https://example.com/t2","content":"腾讯内容2","source":"tenxunwang","publish_time":"2026-05-12 13:59:00"},{"title":"腾讯新闻3","url":"https://example.com/t3","content":"腾讯内容3","source":"tenxunwang","publish_time":"2026-05-12 13:58:00"}]}`)
		case "/news/hot":
			fmt.Fprint(w, `{"success":true,"type":"7*24小时全球直播","data":[{"title":"东财快讯1","content":"东财内容1","url":"https://example.com/e1","time":"2026-05-12 14:05:00"},{"title":"东财快讯2","content":"东财内容2","url":"https://example.com/e2","time":"2026-05-12 14:04:00"},{"title":"东财快讯3","content":"东财内容3","url":"https://example.com/e3","time":"2026-05-12 14:03:00"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	svc := newMarketService(marketServiceConfig{
		HTTPClient:     srv.Client(),
		WeatherCity:    "Beijing",
		WeatherBaseURL: srv.URL + "/weather",
		CryptoURL:      srv.URL + "/crypto",
		GoldURL:        srv.URL + "/gold",
		IndexURL:       srv.URL + "/index",
		DailyNewsURL:   srv.URL + "/news/daily",
		HotNewsURL:     srv.URL + "/news/hot",
	})

	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Weather == nil {
		t.Fatal("expected weather")
	}
	if snapshot.Weather.City != "Beijing" || snapshot.Weather.Condition != "多云" {
		t.Fatalf("unexpected weather: %+v", snapshot.Weather)
	}
	if len(snapshot.Quotes) != 7 {
		t.Fatalf("expected 7 quotes, got %d", len(snapshot.Quotes))
	}
	if len(snapshot.News) != 6 {
		t.Fatalf("expected 6 news items, got %d", len(snapshot.News))
	}
	gotOrder := []string{
		snapshot.Quotes[0].Key,
		snapshot.Quotes[1].Key,
		snapshot.Quotes[2].Key,
		snapshot.Quotes[3].Key,
		snapshot.Quotes[4].Key,
		snapshot.Quotes[5].Key,
		snapshot.Quotes[6].Key,
	}
	wantOrder := []string{"gold", "btc", "eth", "shanghai", "shenzhen", "nasdaq", "hang_seng"}
	if strings.Join(gotOrder, ",") != strings.Join(wantOrder, ",") {
		t.Fatalf("unexpected order: got %v want %v", gotOrder, wantOrder)
	}
	if !strings.Contains(snapshot.Summary, "天气(Beijing) 多云 28C") {
		t.Fatalf("unexpected summary: %s", snapshot.Summary)
	}
	if !strings.Contains(snapshot.Summary, "黄金价格 2360.50 USD") {
		t.Fatalf("summary missing gold: %s", snapshot.Summary)
	}
	if !strings.Contains(snapshot.Summary, "BTC价格 64000.00 USD (+1.25%)") {
		t.Fatalf("summary missing btc: %s", snapshot.Summary)
	}
	if !strings.Contains(snapshot.Summary, "新闻6条") {
		t.Fatalf("summary missing news count: %s", snapshot.Summary)
	}
	if snapshot.News[0].Title != "腾讯新闻1" || snapshot.News[3].Title != "东财快讯1" {
		t.Fatalf("unexpected news order: %+v", snapshot.News)
	}
}

func TestMarketSnapshotAllowsPartialFailures(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/weather/Beijing":
			fmt.Fprint(w, `{"current_condition":[{"temp_C":"22","FeelsLikeC":"21","humidity":"40","weatherDesc":[{"value":"晴"}]}]}`)
		case "/crypto":
			http.Error(w, "boom", http.StatusBadGateway)
		case "/gold":
			fmt.Fprint(w, `{"currency":"USD","price":2360.50}`)
		case "/index":
			fmt.Fprint(w, strings.Join([]string{
				`var hq_str_s_sh000001="name,3100.11,10.10,0.33";`,
				`var hq_str_s_sz399001="name,9900.22,-20.20,-0.20";`,
				`var hq_str_int_nasdaq="name,18000.33,100.10,0.56";`,
				`var hq_str_int_hangseng="name,19000.44,-50.50,-0.27";`,
			}, "\n"))
		case "/news/daily":
			http.Error(w, "boom", http.StatusBadGateway)
		case "/news/hot":
			fmt.Fprint(w, `{"success":true,"type":"7*24小时全球直播","data":[{"title":"东财快讯1","content":"东财内容1","url":"https://example.com/e1","time":"2026-05-12 14:05:00"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	svc := newMarketService(marketServiceConfig{
		HTTPClient:     srv.Client(),
		WeatherCity:    "Beijing",
		WeatherBaseURL: srv.URL + "/weather",
		CryptoURL:      srv.URL + "/crypto",
		GoldURL:        srv.URL + "/gold",
		IndexURL:       srv.URL + "/index",
		DailyNewsURL:   srv.URL + "/news/daily",
		HotNewsURL:     srv.URL + "/news/hot",
	})

	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Quotes) != 5 {
		t.Fatalf("expected 5 quotes without crypto, got %d", len(snapshot.Quotes))
	}
	if len(snapshot.News) != 1 || snapshot.News[0].Title != "东财快讯1" {
		t.Fatalf("expected hot news fallback, got %+v", snapshot.News)
	}
	if len(snapshot.Warnings) == 0 || !strings.Contains(snapshot.Warnings[0], "crypto fetch failed") {
		t.Fatalf("expected crypto warning, got %v", snapshot.Warnings)
	}
}
