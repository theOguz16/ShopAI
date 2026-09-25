path "shopai-production/data/health" {
  capabilities = ["read"]
}

path "shopai-production/data/connectors/*" {
  capabilities = ["read"]
}
