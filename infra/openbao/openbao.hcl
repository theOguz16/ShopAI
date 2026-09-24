ui = false
api_addr = "https://openbao.shopai.internal:8200"
cluster_addr = "https://openbao.shopai.internal:8201"

listener "tcp" {
  address = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_disable = false
  tls_cert_file = "/openbao/tls/server.crt"
  tls_key_file = "/openbao/tls/server.key"
  tls_min_version = "tls12"
}

storage "raft" {
  path = "/openbao/data"
  node_id = "shopai-raft-1"
}

audit "file" "to-stdout" {
  description = "Container audit stream; collect off host"
  options {
    file_path = "stdout"
    log_raw = "false"
  }
}
