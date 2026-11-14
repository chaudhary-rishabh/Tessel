# Backlog

Things noticed along the way that are not needed yet. Each item names the step where it fits best.

- **TypeScript 7:** Upgrade when `typescript-eslint` supports it (see D-003).
- **Visual regression:** Screenshot comparisons in CI for key screens. (Phase 3)
- **Image vulnerability scans in CI:** Run Trivy on the built images. (Phase 3)
- **Gateway cost reconciliation:** Compare ledger costs with the gateway's own usage report nightly, and use the cost the gateway reports for chat calls too (it is already used for embeddings). (Phase 3)
- **Global cap during a Redis outage:** The ledger fallback covers user and workspace caps; the service-wide cap waits for Redis. A cached daily total would close the gap. (Phase 3)
- **Resume a stream after reconnecting:** Buffer live tokens in Redis so a dropped connection or a second tab can pick up a reply in progress, and stop it from any API instance. (Phase 3)
- **Upload scanning:** Malware scanning of uploaded files before they are parsed. (Phase 3)
- **RAG evaluations:** A question set with expected passages, scoring retrieval recall, citation accuracy, and faithfulness, run in CI. (Phase 3)
- **Dedicated reranker:** Try a reranking model through the gateway and compare cost and quality with the utility model (D-041). (Phase 3)
- **Agent evaluations:** Scenarios checking tool choice, argument quality, and that declined actions aren't retried. (Phase 3)
- **Stream moderation:** Check long replies in chunks while they stream, so a blocked reply stops early instead of being replaced at the end. (Phase 3)
- **Key management:** Move the connector encryption key to AWS KMS with envelope encryption and rotation. (Phase 3)
- **Relevant memories only:** Once users have many memories, send the most relevant to each message (by embedding) instead of the newest 60. (Phase 3)
- **Entity resolution:** Merge entities that are the same thing under different names ("Payments" and "Payments Team") with embeddings and a review step. (Phase 3)
- **Community summaries:** Summaries of clusters of related entities for broad questions, as in GraphRAG. (Phase 3)
- **New sign-in alerts:** Email the user when a new device signs in. (Phase 3)
- **Audit log export:** Download a workspace's audit log as CSV, and stream events to a SIEM. (Phase 3)
- **Faster chat search:** A trigram index (`pg_trgm`) on message text once chat history grows; search now scans the user's own messages. (Phase 3)
