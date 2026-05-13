package distill

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestExtractProfileAndBrief(t *testing.T) {
	var items []CorpusItem
	if err := json.Unmarshal(MockCorpusJSON, &items); err != nil {
		t.Fatal(err)
	}
	p := ExtractProfile(items)
	if len(p.TopicClusters) == 0 {
		t.Fatal("expected topic clusters")
	}
	b := ProfileBrief(p)
	if !strings.Contains(b, "话题分布") || !strings.Contains(b, "价值倾向") {
		t.Fatalf("brief: %s", b)
	}
}

func TestPickSnippets(t *testing.T) {
	var items []CorpusItem
	if err := json.Unmarshal(MockCorpusJSON, &items); err != nil {
		t.Fatal(err)
	}
	s := PickSnippets("大模型 RAG 怎么做", items, 3, 200)
	if len(s) == 0 {
		t.Fatal("expected snippets")
	}
	titleJoined := s[0].Title + s[len(s)-1].Title
	if !strings.Contains(titleJoined, "RAG") && !strings.Contains(titleJoined, "模型") {
		t.Logf("titles: %#v", s)
	}
}
