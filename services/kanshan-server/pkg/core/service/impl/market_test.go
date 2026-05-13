package impl

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
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
		case "/news/zhihu":
			if got := r.URL.Query().Get("top_cnt"); got != "5" {
				t.Fatalf("unexpected zhihu top_cnt: %q", got)
			}
			if got := r.URL.Query().Get("publish_in_hours"); got != "72" {
				t.Fatalf("unexpected zhihu publish_in_hours: %q", got)
			}
			if got := r.Header.Get("X-App-Key"); got != "test-user-token" {
				t.Fatalf("unexpected zhihu x-app-key: %q", got)
			}
			if got := r.Header.Get("X-Extra-Info"); got != "" {
				t.Fatalf("unexpected zhihu x-extra-info: %q", got)
			}
			if got := r.Header.Get("X-Timestamp"); got == "" {
				t.Fatal("expected zhihu x-timestamp")
			}
			if got := r.Header.Get("X-Log-Id"); got == "" {
				t.Fatal("expected zhihu x-log-id")
			}
			if got := r.Header.Get("X-Sign"); got == "" {
				t.Fatal("expected zhihu x-sign")
			}
			fmt.Fprint(w, `{"status":0,"msg":"success","data":{"list":[{"title":"知乎热榜1","body":"知乎摘要1","link_url":"https://www.zhihu.com/question/1","published_time":1773216569,"published_time_str":"2026-03-11 16:09:29","type":"QUESTION"},{"title":"知乎热榜2","body":"知乎摘要2","link_url":"https://www.zhihu.com/question/2","published_time":1773216570,"published_time_str":"2026-03-11 16:09:30","type":"QUESTION"},{"title":"知乎热榜3","body":"知乎摘要3","link_url":"https://www.zhihu.com/question/3","published_time":1773216571,"published_time_str":"2026-03-11 16:09:31","type":"QUESTION"}]}}`)
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
		ZhihuHotURL:    srv.URL + "/news/zhihu",
		ZhihuAppKey:    "test-user-token",
		ZhihuAppSecret: "test-app-secret",
		ZhihuTopCount:  5,
		ZhihuHotHours:  72,
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
	if len(snapshot.News) != 9 {
		t.Fatalf("expected 9 news items, got %d", len(snapshot.News))
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
	if !strings.Contains(snapshot.Summary, "新闻9条") {
		t.Fatalf("summary missing news count: %s", snapshot.Summary)
	}
	if snapshot.News[0].Title != "腾讯新闻1" || snapshot.News[3].Title != "东财快讯1" || snapshot.News[6].Title != "知乎热榜1" {
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
		case "/news/zhihu":
			if got := r.URL.Query().Get("top_cnt"); got != "3" {
				t.Fatalf("unexpected zhihu top_cnt: %q", got)
			}
			if got := r.URL.Query().Get("publish_in_hours"); got != "24" {
				t.Fatalf("unexpected zhihu publish_in_hours: %q", got)
			}
			if got := r.Header.Get("X-App-Key"); got != "test-user-token" {
				t.Fatalf("unexpected zhihu x-app-key: %q", got)
			}
			if got := r.Header.Get("X-Sign"); got == "" {
				t.Fatal("expected zhihu x-sign")
			}
			fmt.Fprint(w, `{"status":0,"msg":"success","data":{"list":[{"title":"知乎热榜1","body":"知乎摘要1","link_url":"https://www.zhihu.com/question/1","published_time":1773216569,"published_time_str":"2026-03-11 16:09:29","type":"QUESTION"}]}}`)
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
		ZhihuHotURL:    srv.URL + "/news/zhihu",
		ZhihuAppKey:    "test-user-token",
		ZhihuAppSecret: "test-app-secret",
		ZhihuTopCount:  3,
		ZhihuHotHours:  24,
	})

	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Quotes) != 5 {
		t.Fatalf("expected 5 quotes without crypto, got %d", len(snapshot.Quotes))
	}
	if len(snapshot.News) != 2 || snapshot.News[0].Title != "东财快讯1" || snapshot.News[1].Title != "知乎热榜1" {
		t.Fatalf("expected hot + zhihu news fallback, got %+v", snapshot.News)
	}
	if len(snapshot.Warnings) == 0 || !strings.Contains(snapshot.Warnings[0], "crypto fetch failed") {
		t.Fatalf("expected crypto warning, got %v", snapshot.Warnings)
	}
}

func TestParseZhihuHotPayload(t *testing.T) {
	items, err := parseZhihuHotPayload([]byte(`{
		"status": 0,
		"msg": "success",
		"data": {
			"list": [
				{
					"title": "知乎热榜标题",
					"body": "知乎热榜摘要",
					"link_url": "https://www.zhihu.com/question/123",
					"published_time": 1773216569,
					"published_time_str": "2026-03-11 16:09:29",
					"type": "QUESTION"
				}
			]
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Title != "知乎热榜标题" {
		t.Fatalf("unexpected title: %+v", items[0])
	}
	if items[0].URL != "https://www.zhihu.com/question/123" {
		t.Fatalf("unexpected url: %+v", items[0])
	}
	if items[0].Source != "zhihu-hot" {
		t.Fatalf("unexpected source: %+v", items[0])
	}
	if items[0].Category != "question" {
		t.Fatalf("unexpected category: %+v", items[0])
	}
}

func TestBuildZhihuHotSignature(t *testing.T) {
	got := buildZhihuHotSignature("token-1", "1778569000", "log_abc", "", "secret-1")
	want := "zRRLMjzRilIfE4KdENBZdhu4zKLTtkeem7t3zvNg9zo="
	if got != want {
		t.Fatalf("unexpected signature: got %q want %q", got, want)
	}
}

func TestParseZhihuDeveloperHotListBody(t *testing.T) {
	items, err := parseZhihuDeveloperHotListBody([]byte(`{
		"Code": 0,
		"Message": "ok",
		"Data": {
			"Items": [
				{
					"Title": "开发者热榜标题",
					"Url": "https://www.zhihu.com/question/999",
					"Summary": "摘要一行",
					"ThumbnailUrl": "https://pic.zhihu.com/x.jpg"
				}
			]
		}
	}`), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Title != "开发者热榜标题" || items[0].URL != "https://www.zhihu.com/question/999" {
		t.Fatalf("unexpected items: %+v", items)
	}
	if items[0].Source != "zhihu-hot" || items[0].Category != "zhihu-hotlist" {
		t.Fatalf("unexpected meta: %+v", items[0])
	}
}

func TestFetchZhihuDeveloperHotListHeadersAndQuery(t *testing.T) {
	var gotAuth, gotTs, gotLimit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotTs = r.Header.Get("X-Request-Timestamp")
		gotLimit = r.URL.Query().Get("Limit")
		fmt.Fprint(w, `{"Code":0,"Message":"ok","Data":{"Items":[{"Title":"t","Url":"https://www.zhihu.com/q/1","Summary":"s"}]}}`)
	}))
	defer srv.Close()

	svc := newMarketService(marketServiceConfig{
		HTTPClient:        srv.Client(),
		ZhihuHotURL:       srv.URL + "/hot_list",
		ZhihuBearer:       "secret-token",
		ZhihuHotListLimit: 10,
		ZhihuHotCachePath: filepath.Join(t.TempDir(), "zhihu-hot-cache.json"),
		ZhihuHotCacheTTL:  3600,
	})
	ms := svc.(*marketService)
	news, err := ms.fetchZhihuHotNews(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer secret-token" {
		t.Fatalf("Authorization: got %q", gotAuth)
	}
	if gotTs == "" {
		t.Fatal("expected X-Request-Timestamp")
	}
	if gotLimit != "10" {
		t.Fatalf("Limit: got %q want 10", gotLimit)
	}
	if len(news) != 1 || news[0].Title != "t" {
		t.Fatalf("unexpected news: %+v", news)
	}
}

func TestZhihuHotListCacheHitWithinTTL(t *testing.T) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		fmt.Fprint(w, `{"Code":0,"Message":"ok","Data":{"Items":[{"Title":"a","Url":"https://www.zhihu.com/q/1","Summary":""}]}}`)
	}))
	defer srv.Close()
	svc := newMarketService(marketServiceConfig{
		HTTPClient:        srv.Client(),
		ZhihuHotURL:       srv.URL + "/hot",
		ZhihuBearer:       "tok",
		ZhihuHotListLimit: 10,
		ZhihuHotCacheTTL:  3600,
		ZhihuHotCachePath: filepath.Join(t.TempDir(), "zhihu-hot.json"),
	})
	ms := svc.(*marketService)
	if _, err := ms.fetchZhihuHotNews(context.Background()); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&n) != 1 {
		t.Fatalf("want 1 upstream call, got %d", n)
	}
	if _, err := ms.fetchZhihuHotNews(context.Background()); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&n) != 1 {
		t.Fatalf("want cache hit (still 1 upstream call), got %d", n)
	}
}
