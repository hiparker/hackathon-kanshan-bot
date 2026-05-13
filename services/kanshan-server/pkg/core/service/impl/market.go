package impl

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

const (
	defaultWeatherBaseURL = "https://wttr.in"
	defaultCryptoURL      = "https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22%5D"
	defaultGoldURL        = "https://api.gold-api.com/price/XAU"
	defaultIndexURL       = "https://hq.sinajs.cn/list=s_sh000001,s_sz399001,int_nasdaq,int_hangseng"
	defaultDailyNewsURL   = "https://orz.ai/api/v1/dailynews/?platform=tenxunwang"
	defaultHotNewsURL     = "https://api.tcslw.cn/api/hotlist/eastmoney?type=102"
	defaultZhihuHotURL    = "https://openapi.zhihu.com/openapi/billboard/list"
	defaultWeatherCity    = "Beijing"
	defaultZhihuTopCount  = 50
	defaultZhihuHotHours  = 48
)

type marketService struct {
	httpClient     *http.Client
	weatherCity    string
	weatherBaseURL string
	cryptoURL      string
	goldURL        string
	indexURL       string
	dailyNewsURL   string
	hotNewsURL     string
	zhihuHotURL    string
	zhihuAppKey    string
	zhihuAppSecret string
	zhihuExtraInfo string
	zhihuTopCount  int
	zhihuHotHours  int
}

type marketServiceConfig struct {
	HTTPClient     *http.Client
	WeatherCity    string
	WeatherBaseURL string
	CryptoURL      string
	GoldURL        string
	IndexURL       string
	DailyNewsURL   string
	HotNewsURL     string
	ZhihuHotURL    string
	ZhihuAppKey    string
	ZhihuAppSecret string
	ZhihuExtraInfo string
	ZhihuTopCount  int
	ZhihuHotHours  int
}

// NewMarketService returns a websocket snapshot service backed by public quote APIs.
func NewMarketService() service.MarketService {
	return newMarketService(marketServiceConfig{
		WeatherCity:    envOrDefault("MARKET_WEATHER_CITY", defaultWeatherCity),
		WeatherBaseURL: envOrDefault("MARKET_WEATHER_BASE_URL", defaultWeatherBaseURL),
		CryptoURL:      envOrDefault("MARKET_CRYPTO_URL", defaultCryptoURL),
		GoldURL:        envOrDefault("MARKET_GOLD_URL", defaultGoldURL),
		IndexURL:       envOrDefault("MARKET_INDEX_URL", defaultIndexURL),
		DailyNewsURL:   envOrDefault("MARKET_DAILY_NEWS_URL", defaultDailyNewsURL),
		HotNewsURL:     envOrDefault("MARKET_HOT_NEWS_URL", defaultHotNewsURL),
		ZhihuHotURL:    envOrDefault("MARKET_ZHIHU_HOT_URL", defaultZhihuHotURL),
		ZhihuAppKey:    strings.TrimSpace(os.Getenv("MARKET_ZHIHU_HOT_APP_KEY")),
		ZhihuAppSecret: strings.TrimSpace(os.Getenv("MARKET_ZHIHU_HOT_APP_SECRET")),
		ZhihuExtraInfo: strings.TrimSpace(os.Getenv("MARKET_ZHIHU_HOT_EXTRA_INFO")),
		ZhihuTopCount:  intEnvOrDefault("MARKET_ZHIHU_HOT_TOP_CNT", defaultZhihuTopCount),
		ZhihuHotHours:  intEnvOrDefault("MARKET_ZHIHU_HOT_PUBLISH_IN_HOURS", defaultZhihuHotHours),
	})
}

func newMarketService(cfg marketServiceConfig) service.MarketService {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	if strings.TrimSpace(cfg.WeatherCity) == "" {
		cfg.WeatherCity = defaultWeatherCity
	}
	if strings.TrimSpace(cfg.WeatherBaseURL) == "" {
		cfg.WeatherBaseURL = defaultWeatherBaseURL
	}
	if strings.TrimSpace(cfg.CryptoURL) == "" {
		cfg.CryptoURL = defaultCryptoURL
	}
	if strings.TrimSpace(cfg.GoldURL) == "" {
		cfg.GoldURL = defaultGoldURL
	}
	if strings.TrimSpace(cfg.IndexURL) == "" {
		cfg.IndexURL = defaultIndexURL
	}
	if strings.TrimSpace(cfg.DailyNewsURL) == "" {
		cfg.DailyNewsURL = defaultDailyNewsURL
	}
	if strings.TrimSpace(cfg.HotNewsURL) == "" {
		cfg.HotNewsURL = defaultHotNewsURL
	}
	if strings.TrimSpace(cfg.ZhihuHotURL) == "" {
		cfg.ZhihuHotURL = defaultZhihuHotURL
	}
	if cfg.ZhihuTopCount <= 0 {
		cfg.ZhihuTopCount = defaultZhihuTopCount
	}
	if cfg.ZhihuHotHours <= 0 {
		cfg.ZhihuHotHours = defaultZhihuHotHours
	}
	return &marketService{
		httpClient:     client,
		weatherCity:    cfg.WeatherCity,
		weatherBaseURL: cfg.WeatherBaseURL,
		cryptoURL:      cfg.CryptoURL,
		goldURL:        cfg.GoldURL,
		indexURL:       cfg.IndexURL,
		dailyNewsURL:   cfg.DailyNewsURL,
		hotNewsURL:     cfg.HotNewsURL,
		zhihuHotURL:    cfg.ZhihuHotURL,
		zhihuAppKey:    cfg.ZhihuAppKey,
		zhihuAppSecret: cfg.ZhihuAppSecret,
		zhihuExtraInfo: cfg.ZhihuExtraInfo,
		zhihuTopCount:  cfg.ZhihuTopCount,
		zhihuHotHours:  cfg.ZhihuHotHours,
	}
}

func (s *marketService) Snapshot(ctx context.Context) (service.MarketSnapshot, error) {
	out := service.MarketSnapshot{
		GeneratedAt: time.Now().Unix(),
		Quotes:      make([]service.MarketQuote, 0, 7),
		News:        make([]service.MarketNews, 0, 9),
	}

	type result struct {
		weather *service.MarketWeather
		quotes  []service.MarketQuote
		news    []service.MarketNews
		warning string
	}

	results := make(chan result, 5)
	var wg sync.WaitGroup
	wg.Add(5)

	go func() {
		defer wg.Done()
		weather, err := s.fetchWeather(ctx)
		if err != nil {
			results <- result{warning: "weather fetch failed: " + err.Error()}
			return
		}
		results <- result{weather: &weather}
	}()

	go func() {
		defer wg.Done()
		quotes, err := s.fetchCryptoQuotes(ctx)
		if err != nil {
			results <- result{warning: "crypto fetch failed: " + err.Error()}
			return
		}
		results <- result{quotes: quotes}
	}()

	go func() {
		defer wg.Done()
		quote, err := s.fetchGoldQuote(ctx)
		if err != nil {
			results <- result{warning: "gold fetch failed: " + err.Error()}
			return
		}
		results <- result{quotes: []service.MarketQuote{quote}}
	}()

	go func() {
		defer wg.Done()
		quotes, err := s.fetchIndexQuotes(ctx)
		if err != nil {
			results <- result{warning: "index fetch failed: " + err.Error()}
			return
		}
		results <- result{quotes: quotes}
	}()

	go func() {
		defer wg.Done()
		news, err := s.fetchNews(ctx)
		if err != nil {
			results <- result{warning: "news fetch failed: " + err.Error()}
			return
		}
		results <- result{news: news}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	for item := range results {
		if item.weather != nil {
			out.Weather = item.weather
		}
		if len(item.quotes) > 0 {
			out.Quotes = append(out.Quotes, item.quotes...)
		}
		if len(item.news) > 0 {
			out.News = append(out.News, item.news...)
		}
		if item.warning != "" {
			out.Warnings = append(out.Warnings, item.warning)
		}
	}

	out.Quotes = orderMarketQuotes(out.Quotes)
	out.Summary = buildMarketSummary(out)
	if out.Weather == nil && len(out.Quotes) == 0 && len(out.News) == 0 {
		return service.MarketSnapshot{}, service.ErrInternal
	}
	return out, nil
}

func (s *marketService) fetchWeather(ctx context.Context) (service.MarketWeather, error) {
	weatherURL := strings.TrimRight(s.weatherBaseURL, "/") + "/" + url.PathEscape(s.weatherCity) + "?format=j1&lang=zh"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, weatherURL, nil)
	if err != nil {
		return service.MarketWeather{}, err
	}
	req.Header.Set("User-Agent", "kanshan-server/market-feed")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return service.MarketWeather{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return service.MarketWeather{}, fmt.Errorf("status %d", resp.StatusCode)
	}

	var payload struct {
		CurrentCondition []struct {
			TempC       string `json:"temp_C"`
			FeelsLikeC  string `json:"FeelsLikeC"`
			Humidity    string `json:"humidity"`
			WeatherDesc []struct {
				Value string `json:"value"`
			} `json:"weatherDesc"`
		} `json:"current_condition"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return service.MarketWeather{}, err
	}
	if len(payload.CurrentCondition) == 0 {
		return service.MarketWeather{}, fmt.Errorf("missing current_condition")
	}

	cc := payload.CurrentCondition[0]
	condition := ""
	if len(cc.WeatherDesc) > 0 {
		condition = cc.WeatherDesc[0].Value
	}

	return service.MarketWeather{
		City:       s.weatherCity,
		Condition:  condition,
		TempC:      atoiOrZero(cc.TempC),
		FeelsLikeC: atoiOrZero(cc.FeelsLikeC),
		Humidity:   atoiOrZero(cc.Humidity),
	}, nil
}

func (s *marketService) fetchCryptoQuotes(ctx context.Context) ([]service.MarketQuote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cryptoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "kanshan-server/market-feed")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if quotes, err := parseBinanceQuotes(body); err == nil {
		return quotes, nil
	}
	if quotes, err := parseCoinGeckoQuotes(body); err == nil {
		return quotes, nil
	}
	if quotes, err := parseKrakenQuotes(body); err == nil {
		return quotes, nil
	}
	return nil, fmt.Errorf("unsupported crypto payload")
}

func parseBinanceQuotes(body []byte) ([]service.MarketQuote, error) {
	var payload []struct {
		Symbol             string `json:"symbol"`
		LastPrice          string `json:"lastPrice"`
		PriceChangePercent string `json:"priceChangePercent"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty binance payload")
	}

	quotes := make([]service.MarketQuote, 0, 2)
	for _, item := range payload {
		price, err := strconv.ParseFloat(strings.TrimSpace(item.LastPrice), 64)
		if err != nil {
			continue
		}
		changePct, err := strconv.ParseFloat(strings.TrimSpace(item.PriceChangePercent), 64)
		if err != nil {
			continue
		}
		switch item.Symbol {
		case "BTCUSDT":
			quotes = append(quotes, service.MarketQuote{
				Key:           "btc",
				Label:         "BTC价格",
				Price:         price,
				Unit:          "USD",
				ChangePercent: floatPtr(changePct),
			})
		case "ETHUSDT":
			quotes = append(quotes, service.MarketQuote{
				Key:           "eth",
				Label:         "ETH价格",
				Price:         price,
				Unit:          "USD",
				ChangePercent: floatPtr(changePct),
			})
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("missing binance symbols")
	}
	return orderMarketQuotes(quotes), nil
}

func parseCoinGeckoQuotes(body []byte) ([]service.MarketQuote, error) {
	var payload struct {
		Bitcoin struct {
			USD          float64 `json:"usd"`
			USD24HChange float64 `json:"usd_24h_change"`
		} `json:"bitcoin"`
		Ethereum struct {
			USD          float64 `json:"usd"`
			USD24HChange float64 `json:"usd_24h_change"`
		} `json:"ethereum"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.Bitcoin.USD == 0 && payload.Ethereum.USD == 0 {
		return nil, fmt.Errorf("empty crypto payload")
	}

	return []service.MarketQuote{
		{
			Key:           "btc",
			Label:         "BTC价格",
			Price:         payload.Bitcoin.USD,
			Unit:          "USD",
			ChangePercent: floatPtr(payload.Bitcoin.USD24HChange),
		},
		{
			Key:           "eth",
			Label:         "ETH价格",
			Price:         payload.Ethereum.USD,
			Unit:          "USD",
			ChangePercent: floatPtr(payload.Ethereum.USD24HChange),
		},
	}, nil
}

func parseKrakenQuotes(body []byte) ([]service.MarketQuote, error) {
	var payload struct {
		Error  []string `json:"error"`
		Result map[string]struct {
			C []string `json:"c"`
			O string   `json:"o"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if len(payload.Error) > 0 {
		return nil, fmt.Errorf("%s", strings.Join(payload.Error, "; "))
	}
	if len(payload.Result) == 0 {
		return nil, fmt.Errorf("empty kraken payload")
	}

	quotes := make([]service.MarketQuote, 0, 2)
	for pair, ticker := range payload.Result {
		price, err := parseStringFloat(ticker.C, 0)
		if err != nil {
			continue
		}

		var changePercent *float64
		open, err := strconv.ParseFloat(strings.TrimSpace(ticker.O), 64)
		if err == nil && open != 0 {
			changePercent = floatPtr((price - open) / open * 100.0)
		}

		switch {
		case strings.Contains(pair, "XBT") && strings.Contains(pair, "USD"):
			quotes = append(quotes, service.MarketQuote{
				Key:           "btc",
				Label:         "BTC价格",
				Price:         price,
				Unit:          "USD",
				ChangePercent: changePercent,
			})
		case strings.Contains(pair, "ETH") && strings.Contains(pair, "USD"):
			quotes = append(quotes, service.MarketQuote{
				Key:           "eth",
				Label:         "ETH价格",
				Price:         price,
				Unit:          "USD",
				ChangePercent: changePercent,
			})
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("missing kraken pairs")
	}
	return orderMarketQuotes(quotes), nil
}

func (s *marketService) fetchGoldQuote(ctx context.Context) (service.MarketQuote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.goldURL, nil)
	if err != nil {
		return service.MarketQuote{}, err
	}
	req.Header.Set("User-Agent", "kanshan-server/market-feed")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return service.MarketQuote{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return service.MarketQuote{}, fmt.Errorf("status %d", resp.StatusCode)
	}

	var payload struct {
		Currency string  `json:"currency"`
		Price    float64 `json:"price"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return service.MarketQuote{}, err
	}
	if payload.Price == 0 {
		return service.MarketQuote{}, fmt.Errorf("empty gold payload")
	}
	if payload.Currency == "" {
		payload.Currency = "USD"
	}
	return service.MarketQuote{
		Key:   "gold",
		Label: "黄金价格",
		Price: payload.Price,
		Unit:  payload.Currency,
	}, nil
}

func (s *marketService) fetchIndexQuotes(ctx context.Context) ([]service.MarketQuote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.indexURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Referer", "http://finance.sina.com.cn/")
	req.Header.Set("User-Agent", "kanshan-server/market-feed")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	quotes := make([]service.MarketQuote, 0, 4)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		symbol, fields, err := parseSinaLine(line)
		if err != nil {
			continue
		}
		switch symbol {
		case "s_sh000001":
			quote, err := buildSimpleSinaQuote("shanghai", "上证指数", fields)
			if err == nil {
				quotes = append(quotes, quote)
			}
		case "s_sz399001":
			quote, err := buildSimpleSinaQuote("shenzhen", "深证成指", fields)
			if err == nil {
				quotes = append(quotes, quote)
			}
		case "int_nasdaq":
			quote, err := buildSimpleSinaQuote("nasdaq", "NASDAQ Composite", fields)
			if err == nil {
				quotes = append(quotes, quote)
			}
		case "int_hangseng":
			quote, err := buildSimpleSinaQuote("hang_seng", "HANG SENG INDEX", fields)
			if err == nil {
				quotes = append(quotes, quote)
			}
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("empty index payload")
	}
	return quotes, nil
}

func (s *marketService) fetchNews(ctx context.Context) ([]service.MarketNews, error) {
	news := make([]service.MarketNews, 0, 9)
	seen := make(map[string]struct{}, 9)

	//if items, err := s.fetchDailyNews(ctx); err == nil {
	//	news = appendUniqueNews(news, items, 3, seen)
	//}
	//if items, err := s.fetchHotNews(ctx); err == nil {
	//	news = appendUniqueNews(news, items, 6, seen)
	//}
	if items, err := s.fetchZhihuHotNews(ctx); err == nil {
		news = appendUniqueNews(news, items, 9, seen)
	}
	if len(news) == 0 {
		return nil, fmt.Errorf("empty news payload")
	}
	return news, nil
}

func (s *marketService) fetchDailyNews(ctx context.Context) ([]service.MarketNews, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.dailyNewsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "kanshan-server/market-feed")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	var payload struct {
		Status string `json:"status"`
		Data   []struct {
			Title       string `json:"title"`
			URL         string `json:"url"`
			Content     string `json:"content"`
			Source      string `json:"source"`
			PublishTime string `json:"publish_time"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if len(payload.Data) == 0 {
		return nil, fmt.Errorf("empty daily news payload")
	}

	out := make([]service.MarketNews, 0, minInt(len(payload.Data), 3))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		out = append(out, service.MarketNews{
			Source:      emptyAs(item.Source, "tenxunwang"),
			Category:    "dailynews",
			Title:       strings.TrimSpace(item.Title),
			Summary:     trimSummary(item.Content, 96),
			URL:         strings.TrimSpace(item.URL),
			PublishedAt: strings.TrimSpace(item.PublishTime),
		})
		if len(out) == 3 {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no valid daily news items")
	}
	return out, nil
}

func (s *marketService) fetchHotNews(ctx context.Context) ([]service.MarketNews, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.hotNewsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "kanshan-server/market-feed")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	var payload struct {
		Success bool   `json:"success"`
		Type    string `json:"type"`
		Data    []struct {
			Title   string `json:"title"`
			Content string `json:"content"`
			URL     string `json:"url"`
			Time    string `json:"time"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if len(payload.Data) == 0 {
		return nil, fmt.Errorf("empty hot news payload")
	}

	out := make([]service.MarketNews, 0, minInt(len(payload.Data), 3))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		out = append(out, service.MarketNews{
			Source:      "eastmoney",
			Category:    emptyAs(payload.Type, "7*24小时全球直播"),
			Title:       strings.TrimSpace(item.Title),
			Summary:     trimSummary(item.Content, 96),
			URL:         strings.TrimSpace(item.URL),
			PublishedAt: strings.TrimSpace(item.Time),
		})
		if len(out) == 3 {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no valid hot news items")
	}
	return out, nil
}

func (s *marketService) fetchZhihuHotNews(ctx context.Context) ([]service.MarketNews, error) {
	if strings.TrimSpace(s.zhihuHotURL) == "" {
		return nil, fmt.Errorf("zhihu hot url not configured")
	}
	if s.zhihuAppKey == "" || s.zhihuAppSecret == "" {
		return nil, fmt.Errorf("zhihu hot credentials not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.zhihuHotURL, nil)
	if err != nil {
		return nil, err
	}
	query := req.URL.Query()
	query.Set("top_cnt", strconv.Itoa(s.zhihuTopCount))
	query.Set("publish_in_hours", strconv.Itoa(s.zhihuHotHours))
	req.URL.RawQuery = query.Encode()
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "kanshan-server/market-feed")

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	logID := fmt.Sprintf("log_%d", time.Now().UnixNano())
	signature := buildZhihuHotSignature(s.zhihuAppKey, timestamp, logID, s.zhihuExtraInfo, s.zhihuAppSecret)
	req.Header.Set("X-App-Key", s.zhihuAppKey)
	req.Header.Set("X-Timestamp", timestamp)
	req.Header.Set("X-Log-Id", logID)
	req.Header.Set("X-Extra-Info", s.zhihuExtraInfo)
	req.Header.Set("X-Sign", signature)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseZhihuHotPayload(body)
}

func buildZhihuHotSignature(appKey, timestamp, logID, extraInfo, appSecret string) string {
	signString := fmt.Sprintf("app_key:%s|ts:%s|logid:%s|extra_info:%s", appKey, timestamp, logID, extraInfo)
	mac := hmac.New(sha256.New, []byte(appSecret))
	_, _ = mac.Write([]byte(signString))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func parseZhihuHotPayload(body []byte) ([]service.MarketNews, error) {
	var payload struct {
		Status int    `json:"status"`
		Msg    string `json:"msg"`
		Data   struct {
			List []struct {
				Title            string `json:"title"`
				Body             string `json:"body"`
				LinkURL          string `json:"link_url"`
				PublishedTime    int64  `json:"published_time"`
				PublishedTimeStr string `json:"published_time_str"`
				Type             string `json:"type"`
			} `json:"list"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.Status != 0 {
		return nil, fmt.Errorf("zhihu hot status %d: %s", payload.Status, payload.Msg)
	}
	if len(payload.Data.List) == 0 {
		return nil, fmt.Errorf("empty zhihu hot payload")
	}

	out := make([]service.MarketNews, 0, minInt(len(payload.Data.List), 3))
	for _, item := range payload.Data.List {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}
		publishedAt := strings.TrimSpace(item.PublishedTimeStr)
		if publishedAt == "" && item.PublishedTime > 0 {
			publishedAt = time.Unix(item.PublishedTime, 0).Format(time.DateTime)
		}
		out = append(out, service.MarketNews{
			Source:      "zhihu-hot",
			Category:    emptyAs(strings.ToLower(strings.TrimSpace(item.Type)), "hotlist"),
			Title:       title,
			Summary:     trimSummary(item.Body, 96),
			URL:         strings.TrimSpace(item.LinkURL),
			PublishedAt: publishedAt,
		})
		if len(out) == 3 {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no valid zhihu hot items")
	}
	return out, nil
}

func buildSimpleSinaQuote(key, label string, fields []string) (service.MarketQuote, error) {
	price, err := parseFieldFloat(fields, 1)
	if err != nil {
		return service.MarketQuote{}, err
	}
	change, err := parseFieldFloat(fields, 2)
	if err != nil {
		return service.MarketQuote{}, err
	}
	changePct, err := parseFieldFloat(fields, 3)
	if err != nil {
		return service.MarketQuote{}, err
	}
	return service.MarketQuote{
		Key:           key,
		Label:         label,
		Price:         price,
		Unit:          "points",
		Change:        floatPtr(change),
		ChangePercent: floatPtr(changePct),
	}, nil
}

func parseSinaLine(line string) (string, []string, error) {
	const prefix = "var hq_str_"
	if !strings.HasPrefix(line, prefix) {
		return "", nil, fmt.Errorf("unexpected line")
	}
	parts := strings.SplitN(strings.TrimPrefix(line, prefix), "=", 2)
	if len(parts) != 2 {
		return "", nil, fmt.Errorf("invalid assignment")
	}
	raw := strings.TrimSuffix(parts[1], ";")
	raw = strings.Trim(raw, `"`)
	if raw == "" {
		return parts[0], nil, fmt.Errorf("empty data")
	}
	return parts[0], strings.Split(raw, ","), nil
}

func parseFieldFloat(fields []string, idx int) (float64, error) {
	if idx < 0 || idx >= len(fields) {
		return 0, fmt.Errorf("field %d missing", idx)
	}
	v := strings.TrimSpace(fields[idx])
	if v == "" {
		return 0, fmt.Errorf("field %d empty", idx)
	}
	return strconv.ParseFloat(v, 64)
}

func parseStringFloat(fields []string, idx int) (float64, error) {
	if idx < 0 || idx >= len(fields) {
		return 0, fmt.Errorf("field %d missing", idx)
	}
	return strconv.ParseFloat(strings.TrimSpace(fields[idx]), 64)
}

func orderMarketQuotes(quotes []service.MarketQuote) []service.MarketQuote {
	order := []string{"gold", "btc", "eth", "shanghai", "shenzhen", "nasdaq", "hang_seng"}
	index := make(map[string]service.MarketQuote, len(quotes))
	for _, quote := range quotes {
		index[quote.Key] = quote
	}
	ordered := make([]service.MarketQuote, 0, len(order))
	for _, key := range order {
		quote, ok := index[key]
		if ok {
			ordered = append(ordered, quote)
		}
	}
	return ordered
}

func buildMarketSummary(snapshot service.MarketSnapshot) string {
	parts := make([]string, 0, 1+len(snapshot.Quotes))
	if snapshot.Weather != nil {
		parts = append(parts, fmt.Sprintf("天气(%s) %s %dC 体感%dC 湿度%d%%",
			snapshot.Weather.City,
			snapshot.Weather.Condition,
			snapshot.Weather.TempC,
			snapshot.Weather.FeelsLikeC,
			snapshot.Weather.Humidity,
		))
	}
	for _, quote := range snapshot.Quotes {
		label := fmt.Sprintf("%s %.2f", quote.Label, quote.Price)
		if quote.Unit == "USD" {
			label += " USD"
		}
		if quote.ChangePercent != nil {
			label += fmt.Sprintf(" (%+.2f%%)", *quote.ChangePercent)
		}
		parts = append(parts, label)
	}
	if len(snapshot.News) > 0 {
		parts = append(parts, fmt.Sprintf("新闻%d条", len(snapshot.News)))
	}
	return strings.Join(parts, " | ")
}

func atoiOrZero(s string) int {
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return v
}

func floatPtr(v float64) *float64 { return &v }

func appendUniqueNews(dst, src []service.MarketNews, limit int, seen map[string]struct{}) []service.MarketNews {
	for _, item := range src {
		key := strings.TrimSpace(item.Title)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		dst = append(dst, item)
		if len(dst) >= limit {
			break
		}
	}
	return dst
}

func trimSummary(s string, max int) string {
	s = strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
	if s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

func emptyAs(s, fallback string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	return s
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func intEnvOrDefault(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return parsed
}
