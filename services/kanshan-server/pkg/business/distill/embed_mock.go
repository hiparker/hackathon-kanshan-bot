package distill

import _ "embed"

// MockCorpusJSON is demo writing samples aligned with apps/react-host distillSelfCorpus.
//
//go:embed mock_corpus.json
var MockCorpusJSON []byte
