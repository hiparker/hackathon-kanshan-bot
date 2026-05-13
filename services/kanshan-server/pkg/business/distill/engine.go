// Package distill implements heuristic 「蒸馏自己」侧写与片段召回（与前端 TS 版对齐，供 HTTP/MCP 调用）。
package distill

import (
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// CorpusItem is one piece of user writing (answer, article, long comment).
type CorpusItem struct {
	ID      string `json:"id"`
	Topic   string `json:"topic"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
	Body    string `json:"body"`
}

// TopicCluster groups items by topic.
type TopicCluster struct {
	Topic   string `json:"topic"`
	Count   int    `json:"count"`
	Summary string `json:"summary"`
}

// Profile is the distilled 「侧写」 from corpus.
type Profile struct {
	TopicClusters   []TopicCluster `json:"topic_clusters"`
	StyleHints      []string       `json:"style_hints"`
	ValueTendency   string         `json:"value_tendency"`
	AvgAnswerLength int            `json:"avg_answer_length"`
	FrameworkHints  []string       `json:"framework_hints"`
}

// Snippet is a retrieved passage with score.
type Snippet struct {
	Title string  `json:"title"`
	Text  string  `json:"text"`
	Score float64 `json:"score"`
}

var structMarkers = []string{"首先", "其次", "最后", "综上", "结论", "背景", "下一步", "三段", "复盘", "评测", "分布"}

type valueHint struct {
	Keys  []string
	Label string
}

var valueHints = []valueHint{
	{[]string{"数据", "验证", "评测", "指标"}, "偏实证与可验证"},
	{[]string{"协作", "成本", "复盘", "里程碑"}, "偏工程化协作"},
	{[]string{"习惯", "长期", "追问"}, "偏长期主义与自省"},
}

func averageLength(items []CorpusItem) int {
	if len(items) == 0 {
		return 0
	}
	n := 0
	for _, it := range items {
		n += utf8.RuneCountInString(it.Body)
	}
	return (n + len(items)/2) / len(items)
}

func collectStyleHints(text string) []string {
	var hints []string
	if strings.Contains(text, "三段") || strings.Contains(text, "背景") ||
		strings.Contains(text, "判断") || strings.Contains(text, "下一步") {
		hints = append(hints, "常用「背景—判断—下一步」式展开")
	}
	if strings.Contains(text, "复盘") || strings.Contains(text, "里程碑") || strings.Contains(text, "笔记") {
		hints = append(hints, "强调可复盘与过程留痕")
	}
	if strings.Contains(text, "检索") || strings.Contains(text, "RAG") ||
		strings.Contains(text, "切块") || strings.Contains(text, "引用") {
		hints = append(hints, "技术话题偏好落地路径与边界条件")
	}
	if strings.Contains(text, "追问") || strings.Contains(text, "反例") || strings.Contains(text, "行动") {
		hints = append(hints, "输出习惯带追问与反例")
	}
	if len(hints) > 5 {
		hints = hints[:5]
	}
	return hints
}

func inferValueTendency(items []CorpusItem) string {
	var blob strings.Builder
	for _, it := range items {
		blob.WriteString(it.Body)
		blob.WriteByte('\n')
	}
	s := blob.String()
	type scored struct {
		label string
		score int
	}
	var rows []scored
	for _, row := range valueHints {
		c := 0
		for _, k := range row.Keys {
			if strings.Contains(s, k) {
				c++
			}
		}
		rows = append(rows, scored{row.Label, c})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].score > rows[j].score })
	var labels []string
	for _, r := range rows {
		if r.score > 0 {
			labels = append(labels, r.label)
		}
	}
	if len(labels) == 0 {
		return "稳健、偏理性论述"
	}
	return strings.Join(labels, "；")
}

func frameworkHits(items []CorpusItem) []string {
	var blob strings.Builder
	for _, it := range items {
		blob.WriteString(it.Body)
	}
	s := blob.String()
	var out []string
	for _, m := range structMarkers {
		if strings.Contains(s, m) {
			out = append(out, m)
			if len(out) >= 6 {
				break
			}
		}
	}
	return out
}

// ExtractProfile runs topic clustering and style / value heuristics.
func ExtractProfile(items []CorpusItem) Profile {
	byTopic := map[string][]CorpusItem{}
	for _, it := range items {
		byTopic[it.Topic] = append(byTopic[it.Topic], it)
	}
	var clusters []TopicCluster
	for topic, group := range byTopic {
		summary := ""
		if len(group) > 0 {
			ex := group[0].Excerpt
			summary = trimRunes(ex+"（共 "+strconv.Itoa(len(group))+" 篇）", 120)
		}
		clusters = append(clusters, TopicCluster{
			Topic:   topic,
			Count:   len(group),
			Summary: summary,
		})
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Topic < clusters[j].Topic })

	var allText strings.Builder
	for _, it := range items {
		allText.WriteString(it.Body)
		allText.WriteByte('\n')
	}

	styleHints := collectStyleHints(allText.String())
	return Profile{
		TopicClusters:   clusters,
		StyleHints:      styleHints,
		ValueTendency:   inferValueTendency(items),
		AvgAnswerLength: averageLength(items),
		FrameworkHints:  frameworkHits(items),
	}
}

func trimRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func tokenizeForScore(q string) []string {
	var cleaned strings.Builder
	for _, ru := range q {
		if !unicode.IsSpace(ru) {
			cleaned.WriteRune(ru)
		}
	}
	runes := []rune(cleaned.String())
	seen := map[string]struct{}{}
	var out []string
	for i := 0; i < len(runes); i++ {
		a := string(runes[i])
		if _, ok := seen[a]; !ok {
			seen[a] = struct{}{}
			out = append(out, a)
		}
		if i < len(runes)-1 {
			bi := string(runes[i]) + string(runes[i+1])
			if _, ok := seen[bi]; !ok {
				seen[bi] = struct{}{}
				out = append(out, bi)
			}
		}
	}
	return out
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// PickSnippets scores corpus items against question (char/bigram overlap).
func PickSnippets(question string, items []CorpusItem, maxSnippets int, maxChars int) []Snippet {
	tokens := tokenizeForScore(question)
	if len(tokens) == 0 || len(items) == 0 {
		var out []Snippet
		n := maxSnippets
		if n > len(items) {
			n = len(items)
		}
		for i := 0; i < n; i++ {
			it := items[i]
			out = append(out, Snippet{
				Title: it.Title,
				Text:  trimRunes(it.Excerpt, maxChars),
				Score: 0,
			})
		}
		return out
	}

	type row struct {
		item  CorpusItem
		score float64
	}
	var scored []row
	for _, it := range items {
		blob := it.Topic + "\n" + it.Title + "\n" + it.Body
		var sc float64
		for _, t := range tokens {
			if !strings.Contains(blob, t) {
				continue
			}
			if runeLen(t) >= 2 {
				sc += 2
			} else {
				sc += 0.2
			}
		}
		scored = append(scored, row{it, sc})
	}
	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].item.Title < scored[j].item.Title
	})
	n := maxSnippets
	if n > len(scored) {
		n = len(scored)
	}
	out := make([]Snippet, 0, n)
	for i := 0; i < n; i++ {
		it := scored[i].item
		out = append(out, Snippet{
			Title: it.Title,
			Text:  trimRunes(it.Body, maxChars),
			Score: scored[i].score,
		})
	}
	return out
}

// ProfileBrief formats profile into one paragraph for LLM system prompt.
func ProfileBrief(p Profile) string {
	var topicParts []string
	for _, c := range p.TopicClusters {
		topicParts = append(topicParts, c.Topic+"×"+strconv.Itoa(c.Count))
	}
	topics := strings.Join(topicParts, "、")
	fw := strings.Join(p.FrameworkHints, "、")
	if fw == "" {
		fw = "（无明显结构词）"
	}
	return "话题分布：" + topics + "。价值倾向：" + p.ValueTendency +
		"。常用结构信号：" + fw + "。平均篇幅约 " + strconv.Itoa(p.AvgAnswerLength) + " 字。"
}
