import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { KanshanRuntimeBridge, PetAction, PetRuntimeEvent } from '@kanshan/bridge';
import { createKanshanThreeRuntime } from '@kanshan/three-runtime';
import {
  kanshanActionMeta,
  kanshanClipMap,
  kanshanRawClipSemanticNameMap,
  resolveKanshanClipDialogue,
  resolveKanshanClipName,
} from './kanshanActionConfig';
import type { KanshanPropItem, KanshanTaskItem } from './kanshanMenuData';

export interface KanshanModelPreviewHandle {
  playRawClip(clipName: string): void;
}

export type KanshanRewardToast = { label: string; icon: 'task' | { propId: string } } | null;

type PetMenuPlacement = 'left' | 'right' | 'top' | 'bottom';
type PetSnapEdge = PetMenuPlacement;
type StagePosition = { x: number; y: number };
type DialoguePlacement = 'left' | 'right';
type BubbleMode = 'action' | 'chat';

const STAGE_SIZE = 350;
const STAGE_SAFE_MARGIN = 0;
const CHAT_DIALOGUE_MAX_WIDTH = 320;
const CHAT_DIALOGUE_HORIZONTAL_PADDING = 28;
const CHAT_DIALOGUE_MAX_HEIGHT = 46;

function resolveMenuPlacement(snapEdge?: PetSnapEdge): PetMenuPlacement {
  if (snapEdge === 'left') return 'right';
  if (snapEdge === 'right') return 'left';
  if (snapEdge === 'top') return 'bottom';
  if (snapEdge === 'bottom') return 'top';
  return 'right';
}

function getDefaultStagePosition(): StagePosition {
  if (typeof window === 'undefined') return { x: STAGE_SAFE_MARGIN, y: STAGE_SAFE_MARGIN };

  const { width, height } = getStageBounds();
  return clampStagePosition({
    x: window.innerWidth - width - STAGE_SAFE_MARGIN,
    y: window.innerHeight - height - STAGE_SAFE_MARGIN,
  });
}

function getStageBounds() {
  const width = typeof window === 'undefined' ? STAGE_SIZE : Math.min(STAGE_SIZE, window.innerWidth - STAGE_SAFE_MARGIN * 2);
  const height = typeof window === 'undefined' ? STAGE_SIZE : Math.min(STAGE_SIZE, window.innerHeight - STAGE_SAFE_MARGIN * 2);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

function clampStagePosition(position: StagePosition): StagePosition {
  if (typeof window === 'undefined') return position;

  const { width, height } = getStageBounds();
  const maxX = Math.max(STAGE_SAFE_MARGIN, window.innerWidth - width - STAGE_SAFE_MARGIN);
  const maxY = Math.max(STAGE_SAFE_MARGIN, window.innerHeight - height - STAGE_SAFE_MARGIN);

  return {
    x: Math.min(Math.max(position.x, STAGE_SAFE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, STAGE_SAFE_MARGIN), maxY),
  };
}

function resolveNearestSnapEdge(position: StagePosition): PetSnapEdge {
  const { width, height } = getStageBounds();
  const distances: Record<PetSnapEdge, number> = {
    left: position.x,
    right: Math.max(0, window.innerWidth - position.x - width),
    top: position.y,
    bottom: Math.max(0, window.innerHeight - position.y - height),
  };

  return (Object.entries(distances) as [PetSnapEdge, number][]).sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'left';
}

function resolveSnappedPosition(edge: PetSnapEdge, currentPosition: StagePosition): StagePosition {
  const { width, height } = getStageBounds();
  const nextPosition = { ...currentPosition };

  if (edge === 'left') nextPosition.x = STAGE_SAFE_MARGIN;
  if (edge === 'right') nextPosition.x = window.innerWidth - width - STAGE_SAFE_MARGIN;
  if (edge === 'top') nextPosition.y = STAGE_SAFE_MARGIN;
  if (edge === 'bottom') nextPosition.y = window.innerHeight - height - STAGE_SAFE_MARGIN;

  return clampStagePosition(nextPosition);
}

function isCanvasDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLCanvasElement && target.classList.contains('glb-canvas');
}

function resolveDialoguePlacement(snapEdge: PetSnapEdge): DialoguePlacement {
  return snapEdge === 'right' ? 'left' : 'right';
}


function paginateDialogueByHeight(text: string, maxHeight: number): string[] {
  if (!text.trim()) return [];
  if (typeof document === 'undefined') return [text];

  const wrapper = document.createElement('div');
  const measurement = document.createElement('span');
  wrapper.className = 'pet-dialogue-bubble pet-dialogue-bubble--chat';
  measurement.className = 'pet-dialogue-content pet-dialogue-content--chat';
  wrapper.style.position = 'fixed';
  wrapper.style.visibility = 'hidden';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = '320px';
  wrapper.style.maxWidth = '320px';
  wrapper.style.transform = 'none';
  measurement.style.display = 'block';
  wrapper.appendChild(measurement);
  document.body.appendChild(wrapper);

  const fits = (content: string) => {
    measurement.textContent = content;
    return measurement.getBoundingClientRect().height <= maxHeight;
  };

  const pages: string[] = [];
  let start = 0;

  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    let fitEnd = start + 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(text.slice(start, mid))) {
        fitEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (fitEnd <= start) {
      fitEnd = Math.min(text.length, start + 1);
    }

    pages.push(text.slice(start, fitEnd));
    start = fitEnd;
  }

  document.body.removeChild(wrapper);
  return pages;
}

interface KanshanModelPreviewProps {
  chatError: string;
  chatInput: string;
  dialogueText?: string;
  isDialogueStreaming?: boolean;
  lastUserMessage: string;
  actionRevision: number;
  activeAction: PetAction;
  menuDataStatus: 'idle' | 'loading' | 'ready' | 'error';
  rewardToast: KanshanRewardToast;
  modelUrl: string;
  propItems: KanshanPropItem[];
  taskItems: KanshanTaskItem[];
  onActionEnd?: (action: PetAction) => void;
  onClipNamesChange?: (clipNames: string[]) => void;
  onPatStart: () => void;
  onPatEnd: () => void;
  onRetryMenuData: () => void;
  onSelectProp: (item: KanshanPropItem) => void;
  onSelectTask: (item: KanshanTaskItem) => void;
  onChatInputChange: (value: string) => void;
  onChatInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onChatSubmit: () => void;
}

export const KanshanModelPreview = React.forwardRef<KanshanModelPreviewHandle, KanshanModelPreviewProps>(
  function KanshanModelPreview({
    actionRevision,
    activeAction,
    chatError,
    chatInput,
    menuDataStatus,
    rewardToast,
    modelUrl,
    propItems,
    taskItems,
    dialogueText,
    isDialogueStreaming = false,
    lastUserMessage,
    onActionEnd,
    onClipNamesChange,
    onPatStart,
    onPatEnd,
    onRetryMenuData,
    onSelectProp,
    onSelectTask,
    onChatInputChange,
    onChatInputKeyDown,
    onChatSubmit,
  }, ref) {
    const stageRef = useRef<HTMLElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const runtimeRef = useRef<KanshanRuntimeBridge | null>(null);
    const playbackModeRef = useRef<'semantic' | 'raw'>('semantic');
    const dialogueTimerRef = useRef<number | null>(null);
    const [isStageHovered, setIsStageHovered] = useState(false);
    const [isMenuHovered, setIsMenuHovered] = useState(false);
    const [isChatFocused, setIsChatFocused] = useState(false);
    const [activeMenuItem, setActiveMenuItem] = useState<'pat' | 'props' | 'tasks' | 'chat' | null>(null);
    const [openPanel, setOpenPanel] = useState<'props' | 'tasks' | 'chat' | null>(null);
    const stageDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPosition: StagePosition } | null>(null);
    const patClipNameRef = useRef(resolveKanshanClipName('Idle'));
    const directionDragRef = useRef<{ startX: number; startYaw: number; yaw: number } | null>(null);
    const [stagePosition, setStagePosition] = useState<StagePosition>(() => getDefaultStagePosition());
    const [snapEdge, setSnapEdge] = useState<PetSnapEdge>('right');
    const [isStageDragging, setIsStageDragging] = useState(false);
    const [directionYaw, setDirectionYaw] = useState(0);
    const [dialogueLine, setDialogueLine] = useState('');
    const [chatDialoguePages, setChatDialoguePages] = useState<string[]>([]);
    const [chatDialoguePageIndex, setChatDialoguePageIndex] = useState(0);

    const clearDialogueTimer = () => {
      if (dialogueTimerRef.current === null) return;
      window.clearTimeout(dialogueTimerRef.current);
      dialogueTimerRef.current = null;
    };

    useImperativeHandle(ref, () => ({
      playRawClip(clipName: string) {
        playbackModeRef.current = 'raw';
        runtimeRef.current?.send({ type: 'playClip', clipName, loop: true });
      },
    }), []);

    useEffect(() => {
      const handleWindowResize = () => {
        setStagePosition((current) => resolveSnappedPosition(snapEdge, clampStagePosition(current)));
      };

      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }, [snapEdge]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      onClipNamesChange?.([]);
      const runtime = createKanshanThreeRuntime({ canvas, clipMap: kanshanClipMap, materialMode: 'pbr', modelUrl });
      runtimeRef.current = runtime;
      playbackModeRef.current = 'semantic';
      const showClipDialogue = (clipName: string, durationMs?: number) => {
        const semanticClipName = kanshanRawClipSemanticNameMap[clipName] ?? clipName;
        const line = resolveKanshanClipDialogue(semanticClipName);
        clearDialogueTimer();
        setDialogueLine('');
        if (line) window.setTimeout(() => setDialogueLine(line), 0);
        if (line && durationMs !== undefined) {
          dialogueTimerRef.current = window.setTimeout(() => {
            setDialogueLine('');
            dialogueTimerRef.current = null;
          }, durationMs);
        }
      };
      const unsubscribe = runtime.onEvent((event) => {
        if (event.type === 'actionEnd') onActionEnd?.(event.action);
        if (event.type === 'animationClipStart') showClipDialogue(event.clipName, event.durationMs);
        if (event.type === 'rawClipStart') showClipDialogue(event.clipName, event.durationMs);
        if (event.type === 'rawClipEnd' && event.clipName === patClipNameRef.current) onPatEnd();
        if (event.type === 'animationClipMapReady') onClipNamesChange?.(event.clipNames);
      });

      const resize = () => runtime.resize?.();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
      window.addEventListener('resize', resize);
      resize();

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', resize);
        unsubscribe();
        clearDialogueTimer();
        runtime.destroy();
        runtimeRef.current = null;
      };
    }, [modelUrl, onActionEnd, onClipNamesChange, onPatEnd]);

    const actionDialogueText = dialogueLine;
    const chatDialogueText = dialogueText?.trim() ?? '';

    const menuPlacement = useMemo(() => resolveMenuPlacement(snapEdge), [snapEdge]);
    const isMenuActive = isStageHovered || isMenuHovered || isChatFocused;
    const bubbleMode: BubbleMode = activeMenuItem === 'chat' || openPanel === 'chat' || isChatFocused ? 'chat' : 'action';

    useEffect(() => {
      if (!chatDialogueText) {
        setChatDialoguePages([]);
        setChatDialoguePageIndex(0);
        return;
      }

      const nextPages = paginateDialogueByHeight(chatDialogueText, CHAT_DIALOGUE_MAX_HEIGHT);
      setChatDialoguePages(nextPages);
      setChatDialoguePageIndex(Math.max(0, nextPages.length - 1));
    }, [chatDialogueText]);

    useEffect(() => {
      if (bubbleMode === 'chat') return;
      setChatDialoguePageIndex(0);
    }, [bubbleMode]);

    const chatStatusText = chatError
      ? chatError
      : isDialogueStreaming
        ? '看山正在回复…'
        : lastUserMessage
          ? `上一句：${lastUserMessage}`
          : '按 Enter 发送，Shift+Enter 换行';

    const handleStageDragStart = (event: React.PointerEvent<HTMLElement>) => {
      if (!isCanvasDragTarget(event.target)) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      stageDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition: stagePosition,
      };
      setIsStageDragging(true);
    };

    const handleStageDragMove = (event: React.PointerEvent<HTMLElement>) => {
      const drag = stageDragRef.current;
      if (!drag) return;

      setStagePosition(clampStagePosition({
        x: drag.startPosition.x + event.clientX - drag.startClientX,
        y: drag.startPosition.y + event.clientY - drag.startClientY,
      }));
    };

    const handleStageDragEnd = (event: React.PointerEvent<HTMLElement>) => {
      const drag = stageDragRef.current;
      if (!drag) return;

      if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      }

      stageDragRef.current = null;
      setIsStageDragging(false);
      setStagePosition((current) => {
        const edge = resolveNearestSnapEdge(current);
        setSnapEdge(edge);
        return resolveSnappedPosition(edge, current);
      });
    };

    const handleDirectionDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      directionDragRef.current = { startX: event.clientX, startYaw: directionYaw, yaw: directionYaw };
    };

    const handleDirectionDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = directionDragRef.current;
      if (!drag) return;

      const deltaX = event.clientX - drag.startX;
      const nextYaw = ((drag.startYaw + deltaX * 1.4) % 360 + 360) % 360;
      drag.yaw = nextYaw;
      setDirectionYaw(nextYaw);
      runtimeRef.current?.send({ type: 'setDirection', yaw: nextYaw });
    };

    const handleDirectionDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      directionDragRef.current = null;
    };

    const playPatAction = () => {
      playbackModeRef.current = 'semantic';
      onPatStart();
      runtimeRef.current?.send({
        type: 'playClip',
        clipName: patClipNameRef.current,
        loop: false,
        repetitions: 2,
      });
    };

    useEffect(() => {
      playbackModeRef.current = 'semantic';
      const actionMeta = kanshanActionMeta[activeAction];
      runtimeRef.current?.send({
        type: 'playAction',
        action: activeAction,
        loop: actionMeta?.loop ?? false,
        repetitions: actionMeta?.repetitions,
      });
    }, [activeAction, actionRevision, modelUrl]);

    return (
      <section
        ref={stageRef}
        className={`glb-stage${isStageDragging ? ' is-dragging' : ''}`}
        aria-label="刘看山 GLB 模型 Three.js 预览"
        style={{ left: stagePosition.x, top: stagePosition.y }}
        onPointerDown={handleStageDragStart}
        onPointerMove={handleStageDragMove}
        onPointerUp={handleStageDragEnd}
        onPointerCancel={handleStageDragEnd}
        onPointerEnter={() => setIsStageHovered(true)}
        onPointerLeave={() => {
          setIsStageHovered(false);
        }}
      >
        <canvas ref={canvasRef} className="glb-canvas" />
        <p className="stage-credit">基于@刘看山 二创</p>
        <BubbleDialogue
          actionDialogueText={actionDialogueText}
          bubbleMode={bubbleMode}
          chatDialoguePageIndex={chatDialoguePageIndex}
          chatDialoguePages={chatDialoguePages}
          isDialogueStreaming={isDialogueStreaming}
          onChatDialoguePageIndexChange={setChatDialoguePageIndex}
          snapEdge={snapEdge}
        />
        <KanshanHoverMenu
          chatError={chatError}
          chatInput={chatInput}
          activeMenuItem={activeMenuItem}
          chatStatusText={chatStatusText}
          isActive={isMenuActive}
          isChatFocused={isChatFocused}
          onChatFocusChange={setIsChatFocused}
          onMenuHoverChange={setIsMenuHovered}
          isDialogueStreaming={isDialogueStreaming}
          onActiveMenuItemChange={setActiveMenuItem}
          onOpenPanelChange={setOpenPanel}
          openPanel={openPanel}
          placement={menuPlacement}
          menuDataStatus={menuDataStatus}
          rewardToast={rewardToast}
          propItems={propItems}
          taskItems={taskItems}
          onPat={playPatAction}
          onRetryMenuData={onRetryMenuData}
          onSelectProp={onSelectProp}
          onSelectTask={onSelectTask}
          onChatInputChange={onChatInputChange}
          onChatInputKeyDown={onChatInputKeyDown}
          onChatSubmit={onChatSubmit}
        />
        <button
          className="direction-drag-handle"
          type="button"
          aria-label="左右拖动调整模型朝向"
          onPointerDown={handleDirectionDragStart}
          onPointerMove={handleDirectionDragMove}
          onPointerUp={handleDirectionDragEnd}
          onPointerCancel={handleDirectionDragEnd}
        >
          <DirectionDragIcon />
        </button>
      </section>
    );
  },
);


interface BubbleDialogueProps {
  actionDialogueText: string;
  bubbleMode: BubbleMode;
  chatDialoguePageIndex: number;
  chatDialoguePages: string[];
  isDialogueStreaming: boolean;
  onChatDialoguePageIndexChange: React.Dispatch<React.SetStateAction<number>>;
  snapEdge: PetSnapEdge;
}

function BubbleDialogue({
  actionDialogueText,
  bubbleMode,
  chatDialoguePageIndex,
  chatDialoguePages,
  isDialogueStreaming,
  onChatDialoguePageIndexChange,
  snapEdge,
}: BubbleDialogueProps) {
  const hasTrimmedDialogue = bubbleMode === 'chat' && chatDialoguePages.length > 1;
  const resolvedDialogueText = bubbleMode === 'chat'
    ? (chatDialoguePages[chatDialoguePageIndex] ?? chatDialoguePages.at(-1) ?? '')
    : actionDialogueText;
  const canPageUp = hasTrimmedDialogue && chatDialoguePageIndex > 0;
  const canPageDown = hasTrimmedDialogue && chatDialoguePageIndex < chatDialoguePages.length - 1;

  const isChatBubble = bubbleMode === 'chat';

  return (
    <div className={`pet-dialogue-bubble pet-dialogue-bubble--${resolveDialoguePlacement(snapEdge)} pet-dialogue-bubble--${bubbleMode}`} role="status" aria-live="polite">
      {isChatBubble ? (
        <div className="pet-dialogue-chat-shell">
          {resolvedDialogueText ? (
            <span className="pet-dialogue-content pet-dialogue-content--chat">
              {resolvedDialogueText}
              {isDialogueStreaming && !canPageDown ? <i className="pet-dialogue-caret" aria-hidden="true">▍</i> : null}
            </span>
          ) : null}
          {hasTrimmedDialogue ? (
            <div className="pet-dialogue-pager">
              <button type="button" disabled={!canPageUp} onClick={() => onChatDialoguePageIndexChange((current: number) => Math.max(0, current - 1))}>↑</button>
              <button type="button" disabled={!canPageDown} onClick={() => onChatDialoguePageIndexChange((current: number) => Math.min(chatDialoguePages.length - 1, current + 1))}>↓</button>
            </div>
          ) : null}
        </div>
      ) : resolvedDialogueText ? (
        <span className="pet-dialogue-content pet-dialogue-content--action">
          {resolvedDialogueText}
        </span>
      ) : null}
    </div>
  );
}

interface KanshanHoverMenuProps {
  activeMenuItem: 'pat' | 'props' | 'tasks' | 'chat' | null;
  chatError: string;
  chatInput: string;
  chatStatusText: string;
  isActive: boolean;
  isChatFocused: boolean;
  isDialogueStreaming: boolean;
  openPanel: 'props' | 'tasks' | 'chat' | null;
  placement: PetMenuPlacement;
  menuDataStatus: 'idle' | 'loading' | 'ready' | 'error';
  rewardToast: KanshanRewardToast;
  propItems: KanshanPropItem[];
  taskItems: KanshanTaskItem[];
  onPat: () => void;
  onRetryMenuData: () => void;
  onSelectProp: (item: KanshanPropItem) => void;
  onSelectTask: (item: KanshanTaskItem) => void;
  onChatInputChange: (value: string) => void;
  onChatInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onChatSubmit: () => void;
  onChatFocusChange: (focused: boolean) => void;
  onMenuHoverChange: (hovered: boolean) => void;
  onActiveMenuItemChange: (item: 'pat' | 'props' | 'tasks' | 'chat' | null) => void;
  onOpenPanelChange: (panel: 'props' | 'tasks' | 'chat' | null) => void;
}

function KanshanHoverMenu({
  activeMenuItem,
  chatError,
  chatInput,
  chatStatusText,
  isActive,
  isChatFocused,
  isDialogueStreaming,
  openPanel,
  placement,
  menuDataStatus,
  rewardToast,
  propItems,
  taskItems,
  onPat,
  onRetryMenuData,
  onSelectProp,
  onSelectTask,
  onChatInputChange,
  onChatInputKeyDown,
  onChatSubmit,
  onChatFocusChange,
  onMenuHoverChange,
  onActiveMenuItemChange,
  onOpenPanelChange,
}: KanshanHoverMenuProps) {
  const isChatEntryActive = activeMenuItem === 'chat';

  const closeSubmenu = () => {
    onActiveMenuItemChange(null);
    onOpenPanelChange(null);
  };

  const handleSelectProp = (item: KanshanPropItem) => {
    onSelectProp(item);
    closeSubmenu();
  };

  const handleSelectTask = (item: KanshanTaskItem) => {
    onSelectTask(item);
    closeSubmenu();
  };

  const openPanelForHover = (panel: 'props' | 'tasks' | 'chat') => {
    onActiveMenuItemChange(panel);
    onOpenPanelChange(panel);
  };

  const handlePrimaryHover = (item: 'pat' | 'props' | 'tasks' | 'chat') => {
    onActiveMenuItemChange(item);
    if (item === 'props' || item === 'tasks' || item === 'chat') {
      onOpenPanelChange(item);
      return;
    }

    onOpenPanelChange(null);
  };

  return (
    <>
      <div className="pet-reward-toast" role="status" aria-live="polite">
        {rewardToast ? (
          <span key={`${rewardToast.label}-${typeof rewardToast.icon === 'string' ? rewardToast.icon : rewardToast.icon.propId}`}>
            <RewardToastIcon icon={rewardToast.icon} />
            <span>{rewardToast.label}</span>
            <strong>+1</strong>
          </span>
        ) : null}
      </div>
      <div
        className={`pet-hover-menu pet-hover-menu--${placement}${isActive ? ' is-active' : ''}`}
        aria-label="刘看山互动菜单"
      >
        <div className="pet-menu-actions" onPointerEnter={() => onMenuHoverChange(true)} onPointerLeave={() => { onMenuHoverChange(false); if (!isChatFocused) { onActiveMenuItemChange(null); onOpenPanelChange(null); } }}>
        <div className={`pet-menu-item${activeMenuItem === 'pat' ? ' is-open' : ''}`} onPointerEnter={() => handlePrimaryHover('pat')} onFocus={() => handlePrimaryHover('pat')}>
          <button className={`pet-menu-button${activeMenuItem === 'pat' ? ' is-menu-active' : ''}`} type="button" onClick={onPat}>
            <PatIcon />
            <span>摸摸它</span>
          </button>
        </div>
        <div className={`pet-menu-item${openPanel === 'props' ? ' is-open' : ''}`} onPointerEnter={() => handlePrimaryHover('props')} onFocus={() => handlePrimaryHover('props')}>
          <button className="pet-menu-button" type="button" aria-haspopup="true" aria-expanded={openPanel === 'props'}>
            <PropIcon />
            <span>道具</span>
          </button>
          <div className="pet-submenu" role="menu" aria-label="道具列表">
            <MenuDataContent
              emptyLabel="暂无道具。"
              menuDataStatus={menuDataStatus}
              onRetryMenuData={onRetryMenuData}
            >
              {propItems.map((item) => (
                <button key={item.id} className="pet-submenu-row" type="button" role="menuitem" onClick={() => handleSelectProp(item)}>
                  <span className="pet-submenu-label">
                    <PropItemIcon propId={item.id} />
                    <span>{item.name}</span>
                  </span>
                  <strong>x{item.count}</strong>
                </button>
              ))}
            </MenuDataContent>
          </div>
        </div>
        <div className={`pet-menu-item${openPanel === 'tasks' ? ' is-open' : ''}`} onPointerEnter={() => handlePrimaryHover('tasks')} onFocus={() => handlePrimaryHover('tasks')}>
          <button className="pet-menu-button" type="button" aria-haspopup="true" aria-expanded={openPanel === 'tasks'}>
            <TaskIcon />
            <span>任务</span>
          </button>
          <div className="pet-submenu pet-submenu--wide" role="menu" aria-label="任务列表">
            <MenuDataContent
              emptyLabel="暂无任务。"
              menuDataStatus={menuDataStatus}
              onRetryMenuData={onRetryMenuData}
            >
              {taskItems.map((item) => (
                <button key={item.id} className="pet-submenu-row" type="button" role="menuitem" onClick={() => handleSelectTask(item)}>
                  <span>{item.taskName}</span>
                  <strong>{item.availableCount}/{item.totalCount}</strong>
                </button>
              ))}
            </MenuDataContent>
          </div>
        </div>
        <div className={`pet-menu-item pet-menu-item--chat${openPanel === 'chat' ? ' is-open' : ''}`} onPointerEnter={() => handlePrimaryHover('chat')} onFocus={() => handlePrimaryHover('chat')}>
          <button className={`pet-menu-button${isChatEntryActive ? ' is-menu-active' : ''}`} type="button" aria-haspopup="true" aria-expanded={openPanel === 'chat'}>
            <ChatIcon />
            <span>对话</span>
          </button>
          <div className="pet-submenu pet-submenu--chat" role="dialog" aria-label="和看山对话">
            <textarea
              className="pet-chat-input"
              id="stage-chat-input"
              value={chatInput}
              placeholder="和看山说点什么"
              rows={2}
              onBlur={() => onChatFocusChange(false)}
              onChange={(event) => onChatInputChange(event.target.value)}
              onFocus={() => onChatFocusChange(true)}
              onKeyDown={onChatInputKeyDown}
            />
            <div className="pet-chat-footer">
              <span className={`pet-chat-status${chatError ? ' is-error' : ''}`}>{chatStatusText}</span>
              <button className="pet-chat-submit" type="button" disabled={isDialogueStreaming || chatInput.trim().length === 0} onClick={onChatSubmit}>
                {isDialogueStreaming ? '回复中' : '发送'}
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

interface MenuDataContentProps {
  children: React.ReactNode;
  emptyLabel: string;
  menuDataStatus: 'idle' | 'loading' | 'ready' | 'error';
  onRetryMenuData: () => void;
}

function MenuDataContent({ children, emptyLabel, menuDataStatus, onRetryMenuData }: MenuDataContentProps) {
  const childCount = React.Children.count(children);

  if (menuDataStatus === 'loading' || menuDataStatus === 'idle') {
    return <p className="pet-submenu-state">加载中。</p>;
  }

  if (menuDataStatus === 'error') {
    return (
      <div className="pet-submenu-state">
        <p>加载失败，请重试。</p>
        <button type="button" onClick={onRetryMenuData}>重试</button>
      </div>
    );
  }

  if (childCount === 0) {
    return <p className="pet-submenu-state">{emptyLabel}</p>;
  }

  return <>{children}</>;
}


function DirectionDragIcon() {
  return (
    <svg className="direction-drag-icon" viewBox="0 0 48 24" aria-hidden="true">
      <path d="M20 12H7" />
      <path d="m12 7-5 5 5 5" />
      <path d="M28 12h13" />
      <path d="m36 7 5 5-5 5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="pet-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 7.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-3.8 3v-3H6.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
      <path d="M9 11.5h6" />
      <path d="M9 14.5h4" />
    </svg>
  );
}

function PatIcon() {
  return (
    <svg className="pet-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.4 12.2c-.7-1.7-.3-3.6 1.1-4.5 1.3-.9 3.1-.4 4.2 1.1.7-1.6 2.3-2.4 3.8-1.8 1.7.7 2.3 2.9 1.3 4.9-.8 1.7-2.6 3.3-5.5 4.8-2.5-1.1-4.1-2.6-4.9-4.5Z" />
      <path d="M4.8 8.6c.8-1.4 2-2.5 3.5-3.2" />
      <path d="M19.2 8.6c-.8-1.4-2-2.5-3.5-3.2" />
    </svg>
  );
}

function PropIcon() {
  return (
    <svg className="pet-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 9.5h11l-.8 9h-9.4l-.8-9Z" />
      <path d="M8.2 9.5c.2-2.1 1.8-3.7 3.8-3.7s3.6 1.6 3.8 3.7" />
      <path d="M9.5 13h5" />
    </svg>
  );
}

function PropItemIcon({ propId }: { propId: string }) {
  const iconClassName = 'pet-prop-icon';

  switch (propId) {
    case 'dried-fish':
      return (
        <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.8 12.1c3.7-4.1 8.7-4 13.1-.2-4.2 3.7-9.4 3.8-13.1.2Z" />
          <path d="M17.8 11.9l3-2.7v5.4l-3-2.7Z" />
          <path d="M8.2 10.1c.9 1.2.9 2.7 0 4" />
          <path d="M6.8 11.5h.1" />
        </svg>
      );
    case 'nutrition-can':
      return (
        <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 6.5c0-1.1 2.2-2 5-2s5 .9 5 2v11c0 1.1-2.2 2-5 2s-5-.9-5-2v-11Z" />
          <path d="M7 6.5c0 1.1 2.2 2 5 2s5-.9 5-2" />
          <path d="M8.8 12h6.4" />
          <path d="M10 15h4" />
        </svg>
      );
    case 'cold-medicine':
      return (
        <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.3 7.8a3 3 0 0 1 4.3 0l3.6 3.6a3 3 0 0 1-4.2 4.2L8.3 12a3 3 0 0 1 0-4.2Z" />
          <path d="M10.2 13.9l4.2-4.2" />
          <path d="M6.3 17.5h3.2" />
          <path d="M7.9 15.9v3.2" />
        </svg>
      );
    case 'revive-feather':
      return (
        <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.8 4.8c-6.3.3-10.4 3.6-12 9.9 3.6-.2 7.4-2.4 10.3-6" />
          <path d="M6.8 14.7 4.7 19" />
          <path d="M9.2 13.8l-1.8-2" />
          <path d="M11.7 12.5l-2-2.2" />
          <path d="M14.2 10.7l-1.9-2" />
        </svg>
      );
    case 'energy-drink':
      return (
        <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.5 5.5h7l1 14h-9l1-14Z" />
          <path d="M9.2 5.5h5.6l-.5-2H9.7l-.5 2Z" />
          <path d="m13 9-3 4h2l-1 3.8 3.4-4.8h-2.1L13 9Z" />
        </svg>
      );
    default:
      return <PropIcon />;
  }
}

function RewardToastIcon({ icon }: { icon: Exclude<KanshanRewardToast, null>['icon'] }) {
  if (icon === 'task') return <TaskIcon />;

  return <PropItemIcon propId={icon.propId} />;
}

function TaskIcon() {
  return (
    <svg className="pet-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5.5h10v13H7z" />
      <path d="M9.2 9h5.6" />
      <path d="M9.2 12h5.6" />
      <path d="M9.2 15h3.4" />
      <path d="M15.5 5.5c0-1-1.1-1.8-2.5-1.8s-2.5.8-2.5 1.8" />
    </svg>
  );
}
