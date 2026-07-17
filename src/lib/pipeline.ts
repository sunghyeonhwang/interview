import "server-only";

// 파이프라인 소유자: 인터뷰 세션 또는 애셋 프로젝트 — 같은 URL 파라미터로 둘 다 조회한다
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** iv_briefs를 세션 id 또는 프로젝트 id로 찾는 or 필터 */
export const ownerFilter = (id: string) => `session_id.eq.${id},project_id.eq.${id}`;

export interface DesignProject {
  id: string;
  title: string;
  brand_name: string;
  goal: string | null;
  key_colors: string[];
  asset_paths: string[];
}
