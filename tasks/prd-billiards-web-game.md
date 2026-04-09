# PRD: 台球网页版双人对战游戏

## Introduction

开发一款基于浏览器的中式台球（黑8变体）网络双人对战游戏。玩家通过房间码邀请对手，使用 WebSocket 实现实时同步对战。MVP 目标是完整实现一局中式8球的核心玩法：建房、匹配、击球物理、胜负判定。

---

## Goals

- 支持两名玩家通过浏览器进行实时台球对战（WebSocket）
- 使用 Matter.js 实现可信的台球物理模拟（碰撞、摩擦、旋转）
- 实现中式8球完整规则（分球、黑8制胜）
- MVP 范围内完成从建房到游戏结束的完整流程
- 前端使用 React + Canvas，后端使用 Node.js + WebSocket

---

## User Stories

### US-001: 创建 / 加入房间
**Description:** As a player, I want to create or join a game room so that I can start a match with another player.

**Acceptance Criteria:**
- [ ] 首页显示「创建房间」和「加入房间」两个按钮
- [ ] 创建房间后生成唯一 6 位房间码并展示
- [ ] 输入房间码可加入对应房间
- [ ] 房间满 2 人后自动开始游戏
- [ ] 房间码无效时显示错误提示
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-002: WebSocket 实时连接与状态同步
**Description:** As a player, I want the game state to stay in sync with my opponent so that we see the same board at all times.

**Acceptance Criteria:**
- [ ] 建立 WebSocket 连接，服务端维护房间游戏状态
- [ ] 每次击球后，服务端广播最新球桌状态给双方
- [ ] 断线后显示「对手已断开」提示并暂停游戏
- [ ] 网络延迟 < 200ms 时双方画面一致
- [ ] Typecheck/lint passes

### US-003: 台球桌渲染
**Description:** As a player, I want to see a realistic billiard table so that I can understand the game state at a glance.

**Acceptance Criteria:**
- [ ] Canvas 渲染绿色台球桌、6 个球袋、边框
- [ ] 16 颗球（1-7 纯色、8 黑球、9-15 花色、白球）正确摆放开球阵型
- [ ] 球的编号清晰可见
- [ ] 响应式布局，适配 1280×720 以上屏幕
- [ ] Verify in browser using dev-browser skill

### US-004: 物理引擎集成（Matter.js）
**Description:** As a player, I want balls to move and collide realistically so that the game feels authentic.

**Acceptance Criteria:**
- [ ] 使用 Matter.js 模拟球的运动、碰撞、摩擦
- [ ] 球碰到边框正确反弹
- [ ] 球进袋后从桌面移除
- [ ] 所有球静止后才允许下一次击球
- [ ] Typecheck/lint passes

### US-005: 瞄准与击球
**Description:** As a player, I want to aim and shoot the cue ball so that I can control my shots.

**Acceptance Criteria:**
- [ ] 轮到当前玩家时，鼠标悬停白球显示球杆和瞄准线
- [ ] 拖拽鼠标调整击球方向和力度（力度条显示）
- [ ] 松开鼠标执行击球
- [ ] 非当前回合玩家无法操作
- [ ] Verify in browser using dev-browser skill

### US-006: 中式8球规则实现
**Description:** As a player, I want the game to enforce Chinese 8-ball rules so that the match is fair and correct.

**Acceptance Criteria:**
- [ ] 开球后第一颗进袋的球决定双方分组（纯色/花色）
- [ ] 己方球全进袋后才能打黑8
- [ ] 打黑8进袋且合法则判胜
- [ ] 白球进袋（落袋白球）对手可手放球
- [ ] 犯规（先碰对方球、白球落袋等）切换对手回合并可手放白球
- [ ] 胜负结算页面显示赢家信息
- [ ] Typecheck/lint passes

### US-007: 回合切换与状态显示
**Description:** As a player, I want to know whose turn it is and my ball group so that I can plan my shots.

**Acceptance Criteria:**
- [ ] 界面顶部显示当前回合玩家、双方球组（纯色/花色/未定）
- [ ] 剩余球数实时更新
- [ ] 当前回合玩家高亮提示
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: 后端 Node.js + `ws` 库实现 WebSocket 服务，维护房间列表和游戏状态
- FR-2: 前端 React 管理页面状态（大厅/等待室/游戏中/结算）
- FR-3: Canvas + Matter.js 渲染台球桌与物理模拟
- FR-4: 击球事件由当前玩家客户端发送至服务端，服务端验证合法性后广播新状态
- FR-5: 实现中式8球完整规则（开球、分组、犯规、胜负）
- FR-6: 瞄准线使用直线延伸，显示白球预计碰撞点
- FR-7: 力度通过拖拽距离映射（最大力度对应 100px 拖拽）
- FR-8: 所有球静止（速度 < 0.1px/frame）后切换回合

---

## Non-Goals（不在 MVP 范围内）

- 无用户账号系统、登录注册
- 无排行榜、历史战绩
- 无观战模式
- 无 AI 对手
- 无音效、粒子特效
- 无移动端适配（仅桌面浏览器）
- 无断线重连恢复游戏

---

## Technical Considerations

- **前端：** React 18 + TypeScript，Canvas 2D API，Matter.js 物理引擎
- **后端：** Node.js + `ws` WebSocket 库（无需数据库，内存维护房间状态）
- **通信协议：** JSON 消息格式，事件类型：`join_room`、`start_game`、`shoot`、`game_state`、`game_over`
- **物理权威端：** 服务端运行 Matter.js 计算权威物理状态，客户端仅渲染（避免作弊）
- **物理 tick：** 服务端 60fps
- **项目结构：**
  ```
  /client   React 前端
  /server   Node.js WebSocket 服务
  ```

---

## Success Metrics

- 两名玩家可从建房到完成一局完整游戏，无需刷新页面
- 击球后双方客户端球的位置误差 < 1px
- 所有中式8球核心规则判定正确率 100%

---

## Confirmed Decisions

- ✅ 服务端物理 tick：**60fps**
- ✅ 手放白球：**限定在底线区域**（落袋方的底线半场）
- ✅ 超时规则：**60秒未击球自动切换回合**