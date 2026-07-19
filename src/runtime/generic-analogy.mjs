const GENERIC_ANALOGIES = deepFreeze({
  S01: {
    en: analogy(
      "Labeled toolbox and borrowed tools",
      [
        relation("Your project", "opens and uses", "a package toolbox"),
        relation(
          "That package",
          "relies on",
          "other required tools called dependencies",
        ),
      ],
      "A package is executable code, not a sealed box; versions, transitive dependencies, platform rules, and supply-chain risk still matter.",
    ),
    ko: analogy(
      "이름표가 붙은 공구함과 빌려 쓰는 도구",
      [
        relation("내 프로젝트", "열어 사용한다", "패키지 공구함"),
        relation("그 패키지", "필요로 한다", "의존성이라는 다른 도구"),
      ],
      "패키지는 밀봉된 상자가 아니라 실행 코드입니다. 버전, 전이 의존성, 플랫폼 조건, 공급망 위험은 따로 확인해야 합니다.",
    ),
  },
  S02: {
    en: analogy(
      "Restaurant service counter and kitchen",
      [
        relation("A customer app", "sends an order to", "the server counter"),
        relation("The running server", "handles it and returns", "a response"),
      ],
      "A server is a software role and may span proxies, processes, or machines; it is not always one kitchen that stays running forever.",
    ),
    ko: analogy(
      "식당 주문 창구와 주방",
      [
        relation("사용자 앱", "주문을 보낸다", "서버 창구"),
        relation("실행 중인 서버", "처리해 돌려준다", "응답"),
      ],
      "서버는 소프트웨어 역할이며 프록시·여러 프로세스·여러 기계로 나뉠 수 있습니다. 항상 켜진 주방 하나와 같지는 않습니다.",
    ),
  },
  S03: {
    en: analogy(
      "A labeled setup card for one performance",
      [
        relation(
          "The same program",
          "starts with",
          "an environment setup card",
        ),
        relation(
          "Different cards",
          "change",
          "ports, modes, and service targets",
        ),
      ],
      "Environment values are strings with runtime-specific precedence and inheritance, and secrets can leak through logs or process inspection.",
    ),
    ko: analogy(
      "공연마다 붙이는 이름표 달린 준비 카드",
      [
        relation("같은 프로그램", "시작할 때 받는다", "환경 설정 카드"),
        relation("서로 다른 카드", "바꾼다", "포트·모드·서비스 대상"),
      ],
      "환경값은 문자열이고 우선순위·상속 방식이 실행환경마다 다릅니다. 비밀값은 로그나 프로세스 조회로 노출될 수도 있습니다.",
    ),
  },
  S04: {
    en: analogy(
      "Restaurant menu and order counter",
      [
        relation(
          "A client app",
          "places a defined order through",
          "the API menu",
        ),
        relation("The server kitchen", "returns", "a defined response"),
      ],
      "Unlike a human waiter, an API follows exact endpoints, schemas, methods, limits, and failure rules instead of interpreting an ambiguous order.",
    ),
    ko: analogy(
      "식당 메뉴판과 주문 창구",
      [
        relation("클라이언트 앱", "정해진 주문을 넣는다", "API 메뉴판"),
        relation("서버 주방", "정해진 형식으로 돌려준다", "응답"),
      ],
      "사람 직원과 달리 API는 애매한 주문을 알아서 해석하지 않습니다. 엔드포인트·스키마·메서드·제한·실패 규칙을 정확히 따릅니다.",
    ),
  },
  S05: {
    en: analogy(
      "A temporary access badge",
      [
        relation("A service", "shows", "a token badge"),
        relation(
          "The receiving system",
          "allows only",
          "the badge's scope and lifetime",
        ),
      ],
      "A token is copyable digital data, may not identify a person, and each provider defines scopes, audiences, expiry, and revocation differently.",
    ),
    ko: analogy(
      "기간과 구역이 적힌 임시 출입 배지",
      [
        relation("서비스", "제시한다", "토큰 배지"),
        relation("상대 시스템", "허용한다", "배지의 범위와 유효기간 안의 접근"),
      ],
      "토큰은 복제 가능한 디지털 데이터이고 사람을 뜻하지 않을 수 있습니다. 범위·대상·만료·폐기 규칙도 제공자마다 다릅니다.",
    ),
  },
  S06: {
    en: analogy(
      "Restaurant order ledger and organized pantry",
      [
        relation("Tables and rows", "organize", "orders and inventory records"),
        relation("A query", "asks for or changes", "specific records"),
      ],
      "A real database adds transactions, constraints, indexes, joins, concurrency, NULL handling, and an optimizer; it is not merely a spreadsheet or cupboard.",
    ),
    ko: analogy(
      "식당 주문 장부와 정리된 식재료 창고",
      [
        relation("테이블과 행", "정리한다", "주문·재고 기록"),
        relation("쿼리", "조회하거나 바꾼다", "지정한 기록"),
      ],
      "실제 데이터베이스에는 트랜잭션·제약조건·인덱스·조인·동시성·NULL·최적화기가 있어 단순 장부나 서랍장과 다릅니다.",
    ),
  },
  S07: {
    en: analogy(
      "A standard service directory and connector desk",
      [
        relation("An AI client", "discovers", "listed MCP tools and resources"),
        relation(
          "The MCP server",
          "connects requests to",
          "the underlying service",
        ),
      ],
      "MCP standardizes discovery and calls, but it does not guarantee that a server is trustworthy, correct, read-only, or minimally privileged.",
    ),
    ko: analogy(
      "표준 안내 데스크와 연결 창구",
      [
        relation("AI 클라이언트", "목록에서 찾는다", "MCP 도구와 리소스"),
        relation("MCP 서버", "요청을 연결한다", "실제 서비스"),
      ],
      "MCP는 발견과 호출 방식을 표준화할 뿐, 서버의 신뢰성·정확성·읽기 전용·최소 권한을 보장하지 않습니다.",
    ),
  },
  S08: {
    en: analogy(
      "Badge check and door policy",
      [
        relation("Authentication", "checks", "which badge is presented"),
        relation("Authorization", "decides", "which doors that badge may open"),
      ],
      "Identities can be people, services, processes, or devices, and real policies can depend on resource, time, ownership, and context.",
    ),
    ko: analogy(
      "배지 확인과 문별 출입 규칙",
      [
        relation("인증", "확인한다", "누구의 배지인지"),
        relation("인가", "결정한다", "그 배지로 열 수 있는 문"),
      ],
      "신원은 사람뿐 아니라 서비스·프로세스·기기일 수 있고, 실제 정책은 리소스·시간·소유관계·상황에 따라 달라집니다.",
    ),
  },
  S09: {
    en: analogy(
      "Project binder, shelf address, and change history",
      [
        relation("A repository", "keeps", "project files and version history"),
        relation("A path", "points to", "one location inside that workspace"),
      ],
      "A repository is a graph of commits, refs, and objects rather than a backup folder, and links can give one file more than one path.",
    ),
    ko: analogy(
      "프로젝트 업무철, 서가 주소, 변경 이력",
      [
        relation("저장소", "보관한다", "프로젝트 파일과 버전 이력"),
        relation("경로", "가리킨다", "작업공간 안의 한 위치"),
      ],
      "저장소는 단순 백업 폴더가 아니라 커밋·참조·객체의 그래프이며, 링크 때문에 한 파일에 여러 경로가 생길 수도 있습니다.",
    ),
  },
  S10: {
    en: analogy(
      "Moving a rehearsed setup from workshop to public stage",
      [
        relation(
          "A selected build and configuration",
          "moves to",
          "a target environment",
        ),
        relation(
          "Deployment checks",
          "keep ready",
          "health and rollback paths",
        ),
      ],
      "Deployment can change DNS, secrets, data, traffic, and billing across distributed systems; it is not just copying one folder to one computer.",
    ),
    ko: analogy(
      "연습실의 검증된 구성을 공개 무대로 옮기기",
      [
        relation("선택한 빌드와 설정", "옮겨간다", "대상 환경"),
        relation("배포 점검", "준비한다", "상태 확인과 롤백 경로"),
      ],
      "배포는 분산 시스템의 DNS·비밀값·데이터·트래픽·비용을 바꿀 수 있어 폴더 하나를 컴퓨터 한 대에 복사하는 일과 다릅니다.",
    ),
  },
});

const BEGINNER_SUMMARIES = deepFreeze({
  S01: {
    en: "A package is code you can install. A dependency is the relationship saying your project needs that package.",
    ko: "패키지는 설치해서 쓰는 코드 묶음이고, 의존성은 내 프로젝트가 그 패키지를 필요로 한다는 관계입니다.",
  },
  S02: {
    en: "A process is a program currently running. A server is the role it plays when it waits for requests and sends back responses.",
    ko: "프로세스는 지금 실행 중인 프로그램이고, 서버는 그 프로그램이 요청을 기다렸다가 응답을 돌려주는 역할을 할 때의 이름입니다.",
  },
  S03: {
    en: "An environment is the outside setup a program receives when it starts. Configuration is the set of choices that setup supplies.",
    ko: "환경은 프로그램이 시작할 때 바깥에서 받는 조건이고, 설정은 그 조건으로 전달되는 구체적인 선택값입니다.",
  },
  S04: {
    en: "An API is an agreement for how one program asks another program for something and what kind of answer comes back.",
    ko: "API는 한 프로그램이 다른 프로그램에 무엇을 어떤 형식으로 요청하고, 어떤 답을 받을지 정한 약속입니다.",
  },
  S05: {
    en: "A credential token is a copyable pass with limited access. An LLM token is a chunk of text used for processing and billing; the two share a name, not a job.",
    ko: "인증 토큰은 제한된 접근 권한을 담은 복제 가능한 출입증이고, LLM 토큰은 모델이 처리하고 비용을 계산하는 글 조각입니다. 이름만 같고 역할은 다릅니다.",
  },
  S06: {
    en: "A database keeps structured records. A query asks it to read or change particular records.",
    ko: "데이터베이스는 구조화된 기록을 보관하고, 쿼리는 그중 필요한 기록을 읽거나 바꿔 달라는 요청입니다.",
  },
  S07: {
    en: "MCP is a standard connection that lets an AI app discover what an external server offers and call it in a consistent way.",
    ko: "MCP는 AI 앱이 외부 서버가 제공하는 도구와 데이터를 찾아보고, 같은 방식으로 호출하게 해 주는 표준 연결 규칙입니다.",
  },
  S08: {
    en: "Authentication checks who or what is asking. Authorization decides what that identity is allowed to do.",
    ko: "인증은 누가 요청하는지 확인하고, 인가는 확인된 대상이 무엇을 해도 되는지 결정합니다.",
  },
  S09: {
    en: "A repository keeps a project's files and version history. A path is the address of one location inside it.",
    ko: "저장소는 프로젝트 파일과 변경 이력을 보관하고, 경로는 그 안의 한 위치를 가리키는 주소입니다.",
  },
  S10: {
    en: "Deployment is the controlled move of a tested build and configuration into an environment where other people can use it.",
    ko: "배포는 검증한 빌드와 설정을 다른 사람이 쓸 수 있는 환경으로 안전하게 옮기는 과정입니다.",
  },
});

const FIRST_APP_MAPS = deepFreeze({
  en: `FAIRYTAIL — FIRST APP MAP

IN PLAIN LANGUAGE
A user action becomes an API request. A running server checks it, applies the app's rules, reads or changes structured records in the database, then sends a response back to the app.

ONE FAMILIAR PICTURE
Think of a restaurant order:
- App: the customer writes an order.
- API: the menu and order format say what can be requested.
- Server: the counter and kitchen receive and process it.
- Database: the order ledger and organized pantry keep the records.
- Response: the finished result travels back to the customer.

THE WHOLE FLOW
App → API request → server logic → database query → server response → app

WHERE THE PICTURE BREAKS
An API requires exact endpoints, methods, schemas, limits, and failure rules. A server may span several processes or machines. A database also handles transactions, constraints, indexes, concurrency, and queries that can change or delete data.

KEEP THE FIRST VERSION SMALL
Start with one read-only path: "show task 42." Define one endpoint, one server rule, one database lookup, and one expected response. Add writes, login, and deployment only when that path works.

QUICK CHECK
Which part keeps task 42 after the app closes? Which part decides whether the request is valid?
`,
  ko: `FAIRYTAIL — 첫 앱 연결 지도

한 문장으로
사용자 행동이 API 요청이 되고, 실행 중인 서버가 요청을 검사해 앱 규칙을 적용한 뒤 데이터베이스의 구조화된 기록을 읽거나 바꾸고 응답을 앱으로 돌려줍니다.

익숙한 그림 하나
식당 주문 흐름으로 보면:
- 앱: 손님이 주문서를 씁니다.
- API: 메뉴판과 주문 형식이 무엇을 요청할 수 있는지 정합니다.
- 서버: 주문 창구와 주방이 요청을 받아 처리합니다.
- 데이터베이스: 주문 장부와 정리된 창고가 기록을 보관합니다.
- 응답: 완성된 결과가 다시 손님에게 돌아갑니다.

전체 흐름
앱 → API 요청 → 서버 로직 → 데이터베이스 쿼리 → 서버 응답 → 앱

비유가 깨지는 지점
API는 정확한 엔드포인트·메서드·스키마·제한·실패 규칙을 따릅니다. 서버는 여러 프로세스나 기계로 나뉠 수 있습니다. 데이터베이스에는 트랜잭션·제약조건·인덱스·동시성이 있고, 쿼리는 데이터를 바꾸거나 지울 수도 있습니다.

첫 버전은 작게
먼저 "42번 할 일 보여주기"라는 읽기 전용 경로 하나만 만드세요. 엔드포인트 하나, 서버 규칙 하나, 데이터베이스 조회 하나, 예상 응답 하나를 정합니다. 이 경로가 동작한 뒤 쓰기·로그인·배포를 추가합니다.

빠른 확인
앱을 닫아도 42번 할 일을 보관하는 부분은 무엇인가요? 요청이 유효한지 판단하는 부분은 무엇인가요?
`,
});

/**
 * @typedef {{ from_target: string, relation: string, to_target: string }} GenericRelation
 * @typedef {{ label: string, relations: readonly Readonly<GenericRelation>[], breakpoint: string }} GenericAnalogy
 */

/**
 * Return a generic, non-profile-inferred analogy for first use only.
 *
 * @param {string} scenarioId
 * @param {"en" | "ko"} locale
 * @returns {Readonly<GenericAnalogy> | null}
 */
export function genericAnalogyForScenario(scenarioId, locale) {
  const catalog =
    /** @type {Readonly<Record<string, Readonly<Record<"en" | "ko", Readonly<GenericAnalogy>>>>>} */ (
      /** @type {unknown} */ (GENERIC_ANALOGIES)
    );
  const scenario = catalog[scenarioId];
  if (!scenario || (locale !== "en" && locale !== "ko")) return null;
  return scenario[locale];
}

/**
 * Return the reviewed one-sentence mental model used by the compact direct
 * renderer. It remains valid when a stored user profile supplies the analogy.
 *
 * @param {string} scenarioId
 * @param {"en" | "ko"} locale
 * @returns {string | null}
 */
export function beginnerSummaryForScenario(scenarioId, locale) {
  const catalog =
    /** @type {Readonly<Record<string, Readonly<Record<"en" | "ko", string>>>>} */ (
      /** @type {unknown} */ (BEGINNER_SUMMARIES)
    );
  const scenario = catalog[scenarioId];
  if (!scenario || (locale !== "en" && locale !== "ko")) return null;
  return scenario[locale];
}

/**
 * Return one connected first-app map instead of repeating three standalone
 * cards. Callers use it only when API, server, and database all resolve to the
 * reviewed generic analogy; stored personalized or neutral choices win.
 *
 * @param {"en" | "ko"} locale
 */
export function genericFirstAppMap(locale) {
  return FIRST_APP_MAPS[locale];
}

/** @param {string} label @param {GenericRelation[]} relations @param {string} breakpoint @returns {GenericAnalogy} */
function analogy(label, relations, breakpoint) {
  return { label, relations, breakpoint };
}

/** @param {string} fromTarget @param {string} relationName @param {string} toTarget @returns {GenericRelation} */
function relation(fromTarget, relationName, toTarget) {
  return {
    from_target: fromTarget,
    relation: relationName,
    to_target: toTarget,
  };
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
