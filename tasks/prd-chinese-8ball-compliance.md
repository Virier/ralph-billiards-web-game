# PRD: 中式8球规则合规 + 浏览器验证 + 测试覆盖

## Introduction

当前 MVP（US-001 至 US-011）已完成基础游戏流程，但存在三处关键中式8球规则错误，且所有 UI 故事从未经过浏览器验证。本 PRD 旨在：
1. 修复所有违反中式8球规则的逻辑 Bug
2. 补充缺失的规则判定（无库犯规）
3. 用 dev-browser skill 对关键 UI 进行浏览器验证
4. 为修复后的规则补充 vitest 单元测试，确保规则正确性有测试保障

---

## Goals

- 所有中式8球核心规则在代码层面 100% 正确
- 所有 UI 故事通过 dev-browser 浏览器验证并截图记录
- 新增规则相关单元测试全部通过（typecheck + vitest）
- 不引入新的回归问题（现有 64 个测试继续通过）

---

## 已发现的规则 Bug（实施前必读）

| 编号 | 位置 | 问题描述 |
|------|------|---------|
| BUG-1 | `server/src/index.ts:286` | 每轮结束无条件切换回合，合法进己方球也换人 —— 违反「进球继续」规则 |
| BUG-2 | `server/src/gameLogic.ts:183-185` | 己方球清空后击打黑8被误判犯规（`type==='black'` !== `playerGroup==='solid/stripe'`） |
| BUG-3 | `server/src/gameLogic.ts:198-218` | 犯规后手放白球限定为"己方半场"，中式8球标准为**全台自由放球** |
| BUG-4 | 缺失 | 击球后无进球且无球碰库，应判犯规（中式8球"有效击打"规则） |

---

## User Stories

### US-012: 修复回合继续逻辑（合法进己方球不换人）
**Description:** As a player, I want to keep my turn when I legally pocket a ball from my group, so the game follows Chinese 8-ball rules.

**Acceptance Criteria:**
- [ ] `evaluateTurnEnd` 新增返回字段 `keepTurn: boolean`
- [ ] 未犯规且本轮进了至少一颗己方组球（或开台阶段进了任意非黑8球），`keepTurn = true`
- [ ] 犯规时 `keepTurn = false`（无论是否进球）
- [ ] 开台阶段（groups 未分配）进球不犯规时 `keepTurn = true`
- [ ] `server/src/index.ts` 中 `handleTurnEnd` 根据 `keepTurn` 决定是否切换 `currentPlayer`
- [ ] Typecheck/lint passes
- [ ] 现有 40 个 server 测试继续通过

### US-013: 修复击打黑8球的合法性判定
**Description:** As a player, I want to legally shoot the 8-ball when all my group balls are pocketed, without triggering a false foul.

**Acceptance Criteria:**
- [ ] 当射手己方组所有球均已进袋，击打黑8为合法首次接触（不判犯规）
- [ ] 具体判定逻辑：`firstContact.type === 'black'` 且 `myRemainingGroupBalls.length === 0` → 合法
- [ ] 仍有己方组球残留时击打黑8 → 犯规
- [ ] 仍有己方组球残留时击打黑8并进袋 → 犯规 + 黑8已进 → 对方获胜
- [ ] Typecheck/lint passes
- [ ] 现有测试继续通过

### US-014: 修复手放白球为全台自由放球
**Description:** As a player, I want to place the cue ball anywhere on the table after my opponent fouls, following the Chinese 8-ball standard rule (full-table ball-in-hand).

**Acceptance Criteria:**
- [ ] `validateCueBallPlacement` 移除半场限制，允许放置在台面任意合法位置（需距台边 ≥ BALL_RADIUS + 2）
- [ ] 客户端 `BilliardTable.tsx` 中的放置高亮区域相应更新（全台高亮，而非半台）
- [ ] `server/src/index.ts` 中 `place_cue_ball` 处理逻辑同步更新
- [ ] 超时自动放置位置保持合理（TABLE_WIDTH * 0.25 对当前玩家通用）
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill（手放白球后点击台面验证可放置）

### US-015: 实现无库犯规检测
**Description:** As a player, I want the game to enforce that at least one ball contacts a cushion (or is pocketed) after the cue ball strikes a ball, following Chinese 8-ball rules.

**Acceptance Criteria:**
- [ ] `Room` 新增 `anyCushionContactThisTurn: boolean` 字段
- [ ] `server/src/index.ts` 的 Matter.js collision 事件监听新增墙体碰撞检测：任意球碰到 label 为 `wall` 的 body 时设 `anyCushionContactThisTurn = true`
- [ ] `evaluateTurnEnd` 新增参数 `anyCushionContact: boolean`，在 foul 判定中增加：groups 已分配 + 无进球 + 无库接触 → `isFoul = true`
- [ ] 开台首球（groups 未分配）不应用此规则（避免开球被过度限制）
- [ ] 每次 shoot 重置 `anyCushionContactThisTurn = false`
- [ ] Typecheck/lint passes
- [ ] 现有测试继续通过

### US-016: 补充中式8球规则单元测试
**Description:** As a developer, I want comprehensive unit tests for all fixed/new Chinese 8-ball rules so regressions are caught automatically.

**Acceptance Criteria:**
- [ ] `server/src/__tests__/gameLogic.test.ts` 新增以下测试用例：
  - 进己方球时 `keepTurn = true`，进对方球时 `keepTurn = false`
  - 进黑8且己方球清空 → 胜利
  - 进黑8且己方球未清空 → 失败
  - 己方球清空后击打黑8 → 不判犯规
  - 仍有己方球时击打黑8 → 判犯规
  - 无库且无进球 → 犯规
  - 有库接触 → 不因无库判犯规
  - 开台阶段无库 → 不判犯规
  - 全台放球：`validateCueBallPlacement` 不再限制半场
- [ ] 所有新测试通过（vitest run）
- [ ] Typecheck/lint passes

### US-017: 浏览器验证 - 建房入房及等待室
**Description:** As a QA engineer, I want visual confirmation that the lobby and room flow work correctly in a real browser.

**Acceptance Criteria:**
- [ ] 使用 dev-browser skill 启动前端（`npm run dev:client` + `npm run dev:server`）
- [ ] 验证：首页显示「创建房间」和「加入房间」按钮
- [ ] 验证：点击「创建房间」后显示 6 位房间码和等待界面
- [ ] 验证：输入无效房间码时显示错误提示
- [ ] 截图记录所有验证结果
- [ ] Verify in browser using dev-browser skill

### US-018: 浏览器验证 - 台球桌渲染与瞄准交互
**Description:** As a QA engineer, I want visual confirmation that the billiard table renders correctly and aiming works.

**Acceptance Criteria:**
- [ ] 验证：Canvas 渲染绿色台球桌、6 个球袋、边框
- [ ] 验证：16 颗球开球阵型正确显示
- [ ] 验证：回合状态栏正确显示玩家信息、球组、剩余球数
- [ ] 验证：白球可瞄准（显示瞄准线和力度条）
- [ ] 截图记录渲染结果
- [ ] Verify in browser using dev-browser skill

### US-019: 浏览器验证 - 完整游戏流程与规则交互
**Description:** As a QA engineer, I want visual confirmation that game rules and UI interactions work end-to-end in the browser.

**Acceptance Criteria:**
- [ ] 验证：击球后球正常运动
- [ ] 验证：合法进球后回合不切换（US-012 修复后）
- [ ] 验证：犯规后对方可全台手放白球（US-014 修复后，全台高亮）
- [ ] 验证：60 秒倒计时显示（最后 10 秒红色警告）
- [ ] 验证：游戏结束时显示赢家信息
- [ ] 截图记录各阶段结果
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: 合法进球（无犯规）后当前玩家继续回合，`currentPlayer` 不切换
- FR-2: 开台阶段（playerGroups 均为 'unassigned'）进球时不切换回合
- FR-3: 己方球全进袋时，击打黑8为合法首次接触（判定时检查 `myRemainingGroupBalls.length === 0`）
- FR-4: 犯规后对方可在全台任意位置（台面内，距边 ≥ BALL_RADIUS+2）放置白球
- FR-5: 每次有效击球后，若无球进袋且无球碰库（且 groups 已分配），判定犯规
- FR-6: `evaluateTurnEnd` 签名扩展为返回 `{ gameOver, winner?, isFoul, keepTurn }`
- FR-7: 所有新增规则覆盖率测试在 vitest 中通过
- FR-8: 所有 dev-browser 浏览器验证截图纳入 progress.txt 进度记录

---

## Non-Goals（本 PRD 范围外）

- 不实现推杆犯规（push shot）检测
- 不实现开球无效（4 球未碰库）判定
- 不实现安全球（defensive play）的特殊规则
- 不添加 Playwright 自动化 E2E 测试框架
- 不修改视觉样式或动画效果
- 不实现移动端适配

---

## Technical Considerations

- **修改文件清单：**
  - `server/src/gameLogic.ts`：修复 BUG-2、BUG-3、BUG-4，扩展 `evaluateTurnEnd` 签名
  - `server/src/index.ts`：修复 BUG-1，增加无库碰撞检测，同步 `evaluateTurnEnd` 调用
  - `client/src/BilliardTable.tsx`：更新手放白球高亮区域为全台
  - `server/src/__tests__/gameLogic.test.ts`：新增规则覆盖测试

- **`evaluateTurnEnd` 新签名：**
  ```typescript
  export interface TurnResult {
    gameOver: boolean
    winner?: 0 | 1
    isFoul: boolean
    keepTurn: boolean  // 新增：true = 当前玩家继续
  }
  ```

- **keepTurn 判定逻辑：**
  ```
  keepTurn = !isFoul && !gameOver &&
    ballsPocketedThisTurn 中含有至少一颗属于 shooterGroup 的球
    （开台阶段：含有至少一颗非 cue、非 black 的球）
  ```

- **无库犯规追踪：** 在 `startPhysicsLoop` 的 collisionStart 事件中，同时检测 body label 为 `wall` 的碰撞，设 `room.anyCushionContactThisTurn = true`

- **浏览器验证顺序：** US-017 → US-018 → US-019（先验证功能入口，再验证核心玩法）

---

## Success Metrics

- 所有中式8球核心规则通过代码审查（无已知规则错误）
- 新增 vitest 测试覆盖全部修复规则，现有 64 个测试 + 新增测试全部通过
- dev-browser 浏览器验证完成，无视觉异常，截图记录存档
- typecheck 通过（零 TypeScript 错误）

---

## Open Questions

- 无库犯规是否对开台（break）后第一轮也生效？（建议：开台后 groups 未分配时豁免）
- 超时自动放置白球的位置是否需要随当前 currentPlayer 调整？（建议：保持 TABLE_WIDTH*0.25 作为默认，全台放球下位置合理）
