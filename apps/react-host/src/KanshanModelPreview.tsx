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
type PetSnapEdge = PetMenuPlacement | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type StagePosition = { x: number; y: number };
type DialoguePlacement = PetMenuPlacement;
type BubbleMode = 'action' | 'chat';
type TauriWindowApi = typeof import('@tauri-apps/api/window');
type TauriCoreApi = typeof import('@tauri-apps/api/core');
type DesktopWindowDragState = {
  appWindow: ReturnType<TauriWindowApi['getCurrentWindow']>;
  coreApi: TauriCoreApi;
  pointerId: number;
  scale: number;
  stagePointerX: number;
  stagePointerY: number;
  stageViewportLeft: number;
  stageViewportTop: number;
  windowApi: TauriWindowApi;
};

const STAGE_SIZE = 300;
/** 桌面端仅舞台中心 50% 触发窗口拖动；整舞台仍接收事件以兼顾菜单/气泡悬停。 */
const DESKTOP_WINDOW_DRAG_MARGIN_FRAC = 0.25;
const INTERACTION_GRACE_MS = 420;
const ZHIDA_AI_URL = 'https://zhida.ai/';
const CHAT_DIALOGUE_EMPTY_TEXT = '和我说点什么吧，我会在这里回应你。';

function isInDesktopWindowDragBand(clientX: number, clientY: number, stageRect: DOMRectReadOnly) {
  const lx = clientX - stageRect.left;
  const ly = clientY - stageRect.top;
  const mx = stageRect.width * DESKTOP_WINDOW_DRAG_MARGIN_FRAC;
  const my = stageRect.height * DESKTOP_WINDOW_DRAG_MARGIN_FRAC;
  return lx >= mx && lx <= stageRect.width - mx && ly >= my && ly <= stageRect.height - my;
}

const STAGE_SAFE_MARGIN = 0;
const CHAT_DIALOGUE_VISIBLE_LINES = 3;

function resolveMenuPlacement(snapEdge?: PetSnapEdge): PetMenuPlacement {
  if (snapEdge === 'right' || snapEdge === 'top-right' || snapEdge === 'bottom-right') return 'left';
  return 'right';
}

function isPetSnapEdge(value: string): value is PetSnapEdge {
  return value === 'left'
    || value === 'right'
    || value === 'top'
    || value === 'bottom'
    || value === 'top-left'
    || value === 'top-right'
    || value === 'bottom-left'
    || value === 'bottom-right';
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
    'top-left': Math.hypot(position.x, position.y),
    'top-right': Math.hypot(Math.max(0, window.innerWidth - position.x - width), position.y),
    'bottom-left': Math.hypot(position.x, Math.max(0, window.innerHeight - position.y - height)),
    'bottom-right': Math.hypot(
      Math.max(0, window.innerWidth - position.x - width),
      Math.max(0, window.innerHeight - position.y - height),
    ),
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
  if (edge === 'top-left') {
    nextPosition.x = STAGE_SAFE_MARGIN;
    nextPosition.y = STAGE_SAFE_MARGIN;
  }
  if (edge === 'top-right') {
    nextPosition.x = window.innerWidth - width - STAGE_SAFE_MARGIN;
    nextPosition.y = STAGE_SAFE_MARGIN;
  }
  if (edge === 'bottom-left') {
    nextPosition.x = STAGE_SAFE_MARGIN;
    nextPosition.y = window.innerHeight - height - STAGE_SAFE_MARGIN;
  }
  if (edge === 'bottom-right') {
    nextPosition.x = window.innerWidth - width - STAGE_SAFE_MARGIN;
    nextPosition.y = window.innerHeight - height - STAGE_SAFE_MARGIN;
  }

  return clampStagePosition(nextPosition);
}

function resolveDesktopSnapEdge(distances: Pick<Record<PetSnapEdge, number>, 'left' | 'right' | 'top' | 'bottom'>): PetSnapEdge {
  const edgeDistances: [PetMenuPlacement, number][] = [
    ['left', distances.left],
    ['right', distances.right],
    ['top', distances.top],
    ['bottom', distances.bottom],
  ];

  return edgeDistances.sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'right';
}

function isCanvasDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLCanvasElement && target.classList.contains('glb-canvas');
}

function resolveDialoguePlacement(snapEdge: PetSnapEdge): DialoguePlacement {
  return resolveMenuPlacement(snapEdge) === 'left' ? 'left' : 'right';
}


function paginateDialogueByHeight(text: string, shell: HTMLElement | null, lines: number): string[] {
  if (!text.trim()) return [];
  if (typeof document === 'undefined') return [text];
  if (!shell) return [text];

  const shellStyle = window.getComputedStyle(shell);
  const padLeft = parseFloat(shellStyle.paddingLeft) || 0;
  const padRight = parseFloat(shellStyle.paddingRight) || 0;
  const contentWidth = Math.max(0, shell.clientWidth - padLeft - padRight);

  const measurement = document.createElement('span');
  measurement.className = 'pet-dialogue-content pet-dialogue-content--chat';
  measurement.setAttribute('aria-hidden', 'true');
  measurement.style.position = 'absolute';
  measurement.style.left = `${padLeft}px`;
  measurement.style.top = '0';
  measurement.style.width = `${contentWidth}px`;
  measurement.style.maxWidth = `${contentWidth}px`;
  measurement.style.minWidth = '0';
  measurement.style.visibility = 'hidden';
  measurement.style.pointerEvents = 'none';
  measurement.style.zIndex = '-1';
  measurement.style.margin = '0';
  measurement.style.boxSizing = 'border-box';
  measurement.style.whiteSpace = 'normal';
  measurement.style.overflowWrap = 'anywhere';
  measurement.style.wordBreak = 'break-word';

  const previousPosition = shell.style.position;
  if (!previousPosition) {
    shell.style.position = 'relative';
  }
  shell.appendChild(measurement);

  measurement.textContent = '一';
  const singleLineHeight = measurement.getBoundingClientRect().height;
  const fallbackFontSize = parseFloat(window.getComputedStyle(measurement).fontSize) || 13;
  const lineHeight = singleLineHeight > 0 ? singleLineHeight : fallbackFontSize * 1.35;
  const maxHeight = lineHeight * lines + lineHeight * 0.4;

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

  shell.removeChild(measurement);
  if (!previousPosition) {
    shell.style.position = '';
  }

  return pages;
}

interface KanshanModelPreviewProps {
  chatError: string;
  chatInput: string;
  desktopMode?: boolean;
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
    chatInput,
    desktopMode = false,
    menuDataStatus,
    rewardToast,
    modelUrl,
    propItems,
    taskItems,
    dialogueText,
    isDialogueStreaming = false,
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
    const chatShellRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const runtimeRef = useRef<KanshanRuntimeBridge | null>(null);
    const playbackModeRef = useRef<'semantic' | 'raw'>('semantic');
    const dialogueTimerRef = useRef<number | null>(null);
    const stageHoverGraceTimerRef = useRef<number | null>(null);
    const dialogueHoverGraceTimerRef = useRef<number | null>(null);
    const desktopWindowDragRef = useRef<DesktopWindowDragState | null>(null);
    const desktopWindowApiRef = useRef<TauriWindowApi | null>(null);
    const desktopCoreApiRef = useRef<TauriCoreApi | null>(null);
    const [isStageHovered, setIsStageHovered] = useState(false);
    const [isMenuHovered, setIsMenuHovered] = useState(false);
    const [isChatFocused, setIsChatFocused] = useState(false);
    const [isDialogueHovered, setIsDialogueHovered] = useState(false);
    const [activeMenuItem, setActiveMenuItem] = useState<'pat' | 'props' | 'tasks' | 'chat' | null>(null);
    const [openPanel, setOpenPanel] = useState<'props' | 'tasks' | 'chat' | null>(null);
    const stageDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPosition: StagePosition } | null>(null);
    const patClipNameRef = useRef(resolveKanshanClipName('Idle'));
    const directionDragRef = useRef<{ startX: number; startYaw: number; yaw: number } | null>(null);
    const [stagePosition, setStagePosition] = useState<StagePosition>(() => getDefaultStagePosition());
    const [snapEdge, setSnapEdge] = useState<PetSnapEdge>('right');
    const [desktopMenuPlacement, setDesktopMenuPlacement] = useState<PetMenuPlacement>('left');
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

    const clearStageHoverGraceTimer = () => {
      if (stageHoverGraceTimerRef.current === null) return;
      window.clearTimeout(stageHoverGraceTimerRef.current);
      stageHoverGraceTimerRef.current = null;
    };

    const clearDialogueHoverGraceTimer = () => {
      if (dialogueHoverGraceTimerRef.current === null) return;
      window.clearTimeout(dialogueHoverGraceTimerRef.current);
      dialogueHoverGraceTimerRef.current = null;
    };

    const handleDialogueHoverChange = (hovered: boolean) => {
      clearDialogueHoverGraceTimer();
      if (hovered) {
        setIsDialogueHovered(true);
        return;
      }
      dialogueHoverGraceTimerRef.current = window.setTimeout(() => {
        setIsDialogueHovered(false);
        dialogueHoverGraceTimerRef.current = null;
      }, INTERACTION_GRACE_MS);
    };

    useImperativeHandle(ref, () => ({
      playRawClip(clipName: string) {
        playbackModeRef.current = 'raw';
        runtimeRef.current?.send({ type: 'playClip', clipName, loop: true });
      },
    }), []);

    useEffect(() => clearStageHoverGraceTimer, []);
    useEffect(() => clearDialogueHoverGraceTimer, []);

    useEffect(() => {
      if (desktopMode) return;

      const handleWindowResize = () => {
        setStagePosition((current) => resolveSnappedPosition(snapEdge, clampStagePosition(current)));
      };

      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }, [desktopMode, snapEdge]);

    useEffect(() => {
      if (!desktopMode) return;
      let unlisten: (() => void) | null = null;
      let cancelled = false;

      (async () => {
        try {
          const [eventApi, windowApi, coreApi] = await Promise.all([
            import('@tauri-apps/api/event'),
            import('@tauri-apps/api/window'),
            import('@tauri-apps/api/core'),
          ]);
          desktopWindowApiRef.current = windowApi;
          desktopCoreApiRef.current = coreApi;
          const dispose = await eventApi.listen<string>('kanshan://snap-edge', ({ payload }) => {
            if (isPetSnapEdge(payload)) {
              setSnapEdge(payload);
            }
          });
          if (cancelled) {
            dispose();
            return;
          }
          unlisten = dispose;
        } catch (error) {
          console.warn('[kanshan] failed to listen Tauri snap edge event', error);
        }
      })();

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }, [desktopMode]);

    useEffect(() => {
      if (!desktopMode) return;
      let cancelled = false;

      const syncInteractiveRegions = async () => {
        const stage = stageRef.current;
        if (!stage) return;

        try {
          const [windowApi, coreApi] = await Promise.all([
            desktopWindowApiRef.current ?? import('@tauri-apps/api/window'),
            desktopCoreApiRef.current ?? import('@tauri-apps/api/core'),
          ]);
          if (cancelled) return;
          desktopWindowApiRef.current = windowApi;
          desktopCoreApiRef.current = coreApi;

          const scale = await windowApi.getCurrentWindow().scaleFactor();
          const stageRect = stage.getBoundingClientRect();
          await coreApi.invoke('kanshan_set_stage_position', {
            x: stageRect.left * scale,
            y: stageRect.top * scale,
          });

          const selectors = [
            '.pet-hover-menu.is-active',
            '.pet-menu-actions',
            '.pet-submenu',
            '.pet-dialogue-bubble',
            '.pet-dialogue-chat-shell',
            '.pet-dialogue-pager',
            '.direction-drag-handle',
            '.pet-reward-toast',
          ].join(',');
          const regions = Array.from(stage.querySelectorAll<HTMLElement>(selectors))
            .filter((element) => {
              const style = window.getComputedStyle(element);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                x: rect.left * scale,
                y: rect.top * scale,
                width: rect.width * scale,
                height: rect.height * scale,
              };
            })
            .filter((rect) => rect.width > 0 && rect.height > 0);

          await coreApi.invoke('kanshan_set_interactive_regions', { regions });
        } catch (error) {
          console.warn('[kanshan] failed to sync desktop interactive regions', error);
        }
      };

      void syncInteractiveRegions();
      const onResize = () => void syncInteractiveRegions();
      window.addEventListener('resize', onResize);
      const intervalId = window.setInterval(() => {
        if (!cancelled) void syncInteractiveRegions();
      }, 72);

      return () => {
        cancelled = true;
        window.removeEventListener('resize', onResize);
        window.clearInterval(intervalId);
      };
    }, [desktopMode]);

    const desktopStageStyle = useMemo<React.CSSProperties | undefined>(() => {
      if (!desktopMode) return undefined;
      switch (snapEdge) {
        case 'left':
          return { left: 0, top: '50%', transform: 'translateY(-50%)' };
        case 'top-left':
          return { left: 0, top: 0 };
        case 'bottom-left':
          return { left: 0, bottom: 0 };
        case 'top':
          return { top: 0, left: '50%', transform: 'translateX(-50%)' };
        case 'bottom':
          return { bottom: 0, left: '50%', transform: 'translateX(-50%)' };
        case 'top-right':
          return { right: 0, top: 0 };
        case 'bottom-right':
          return { right: 0, bottom: 0 };
        case 'right':
        default:
          return { right: 0, top: '50%', transform: 'translateY(-50%)' };
      }
    }, [desktopMode, snapEdge]);

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

    const menuPlacement = useMemo(
      () => (desktopMode ? desktopMenuPlacement : resolveMenuPlacement(snapEdge)),
      [desktopMenuPlacement, desktopMode, snapEdge],
    );
    const isMenuActive = isStageHovered || isMenuHovered;
    const hasChatDialogue = chatDialogueText.length > 0 || isDialogueStreaming;
    const isChatPanelActive = activeMenuItem === 'chat' || openPanel === 'chat' || isChatFocused;
    const shouldShowChatBubble = isChatPanelActive || isDialogueHovered || isDialogueStreaming || (!actionDialogueText && hasChatDialogue);
    const bubbleMode: BubbleMode = shouldShowChatBubble ? 'chat' : 'action';

    useEffect(() => {
      if (!chatDialogueText) {
        setChatDialoguePages([]);
        setChatDialoguePageIndex(0);
        return;
      }

      const repaginate = () => {
        const nextPages = paginateDialogueByHeight(
          chatDialogueText,
          chatShellRef.current,
          CHAT_DIALOGUE_VISIBLE_LINES,
        );
        setChatDialoguePages(nextPages);
        setChatDialoguePageIndex(Math.max(0, nextPages.length - 1));
      };

      repaginate();

      const shell = chatShellRef.current;
      if (!shell || typeof ResizeObserver === 'undefined') return;

      let lastWidth = shell.getBoundingClientRect().width;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const nextWidth = entry.contentRect.width;
        if (Math.abs(nextWidth - lastWidth) < 0.5) return;
        lastWidth = nextWidth;
        repaginate();
      });
      observer.observe(shell);
      return () => observer.disconnect();
    }, [chatDialogueText, bubbleMode]);

    useEffect(() => {
      if (bubbleMode === 'chat') return;
      setChatDialoguePageIndex(0);
    }, [bubbleMode]);

    const handleStageDragStart = (event: React.PointerEvent<HTMLElement>) => {
      if (!isCanvasDragTarget(event.target)) return;

      if (desktopMode) {
        const stageRect = event.currentTarget.getBoundingClientRect();
        if (!isInDesktopWindowDragBand(event.clientX, event.clientY, stageRect)) {
          return;
        }

        void (async () => {
          try {
            const coreApi = desktopCoreApiRef.current ?? (await import('@tauri-apps/api/core'));
            desktopCoreApiRef.current = coreApi;
            await coreApi.invoke('kanshan_set_passthrough_suppressed', { suppress: true });
          } catch (error) {
            console.warn('[kanshan] kanshan_set_passthrough_suppressed', error);
          }
        })();

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsStageDragging(true);

        void (async () => {
          try {
            const [windowApi, coreApi] = await Promise.all([
              desktopWindowApiRef.current ?? import('@tauri-apps/api/window'),
              desktopCoreApiRef.current ?? import('@tauri-apps/api/core'),
            ]);
            desktopWindowApiRef.current = windowApi;
            desktopCoreApiRef.current = coreApi;
            const appWindow = windowApi.getCurrentWindow();
            desktopWindowDragRef.current = {
              appWindow,
              coreApi,
              pointerId: event.pointerId,
              scale: await appWindow.scaleFactor(),
              stagePointerX: event.clientX - stageRect.left,
              stagePointerY: event.clientY - stageRect.top,
              stageViewportLeft: stageRect.left,
              stageViewportTop: stageRect.top,
              windowApi,
            };
          } catch (error) {
            desktopWindowDragRef.current = null;
            setIsStageDragging(false);
            try {
              const coreApi = desktopCoreApiRef.current ?? (await import('@tauri-apps/api/core'));
              desktopCoreApiRef.current = coreApi;
              await coreApi.invoke('kanshan_set_passthrough_suppressed', { suppress: false });
            } catch {
              /* ignore */
            }
            console.warn('[kanshan] failed to start desktop window drag', error);
          }
        })();
        return;
      }

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
      if (desktopMode) {
        const drag = desktopWindowDragRef.current;
        if (!drag) return;

        event.preventDefault();
        const nextX = (event.screenX - drag.stagePointerX - drag.stageViewportLeft) * drag.scale;
        const nextY = (event.screenY - drag.stagePointerY - drag.stageViewportTop) * drag.scale;
        void drag.appWindow.setPosition(new drag.windowApi.PhysicalPosition(Math.round(nextX), Math.round(nextY)));
        return;
      }

      const drag = stageDragRef.current;
      if (!drag) return;

      setStagePosition(clampStagePosition({
        x: drag.startPosition.x + event.clientX - drag.startClientX,
        y: drag.startPosition.y + event.clientY - drag.startClientY,
      }));
    };

    const handleStageDragEnd = (event: React.PointerEvent<HTMLElement>) => {
      if (desktopMode) {
        void (async () => {
          try {
            const coreApi = desktopCoreApiRef.current ?? (await import('@tauri-apps/api/core'));
            desktopCoreApiRef.current = coreApi;
            await coreApi.invoke('kanshan_set_passthrough_suppressed', { suppress: false });
          } catch {
            /* ignore */
          }
        })();

        const drag = desktopWindowDragRef.current;
        if (!drag) return;

        if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
          event.currentTarget.releasePointerCapture(drag.pointerId);
        }

        desktopWindowDragRef.current = null;
        setIsStageDragging(false);
        event.preventDefault();

        void (async () => {
          try {
            const [position, size, monitor] = await Promise.all([
              drag.appWindow.outerPosition(),
              drag.appWindow.outerSize(),
              drag.windowApi.currentMonitor(),
            ]);
            const workArea = monitor?.workArea;
            if (!workArea) return;

            const stageLeft = position.x + drag.stageViewportLeft * drag.scale;
            const stageTop = position.y + drag.stageViewportTop * drag.scale;
            const stageSize = STAGE_SIZE * drag.scale;
            const stageRight = stageLeft + stageSize;
            const stageBottom = stageTop + stageSize;
            const workLeft = workArea.position.x;
            const workTop = workArea.position.y;
            const workRight = workLeft + workArea.size.width;
            const workBottom = workTop + workArea.size.height;
            const distLeft = Math.max(0, stageLeft - workLeft);
            const distRight = Math.max(0, workRight - stageRight);
            const distTop = Math.max(0, stageTop - workTop);
            const distBottom = Math.max(0, workBottom - stageBottom);
            const distances: Record<PetSnapEdge, number> = {
              left: distLeft,
              right: distRight,
              top: distTop,
              bottom: distBottom,
              'top-left': Math.hypot(distLeft, distTop),
              'top-right': Math.hypot(distRight, distTop),
              'bottom-left': Math.hypot(distLeft, distBottom),
              'bottom-right': Math.hypot(distRight, distBottom),
            };
            const edge = resolveDesktopSnapEdge(distances);
            const stageCenterX = stageLeft + stageSize / 2;
            const nextMenuPlacement: PetMenuPlacement = stageCenterX > workLeft + workArea.size.width / 2 ? 'left' : 'right';

            setSnapEdge(edge);
            setDesktopMenuPlacement(nextMenuPlacement);

            let targetX = position.x;
            let targetY = position.y;
            if (edge === 'left') targetX = workLeft - drag.stageViewportLeft * drag.scale;
            if (edge === 'right') targetX = workRight - stageSize - drag.stageViewportLeft * drag.scale;
            if (edge === 'top') targetY = workTop - drag.stageViewportTop * drag.scale;
            if (edge === 'bottom') targetY = workBottom - stageSize - drag.stageViewportTop * drag.scale;

            targetX = Math.min(Math.max(targetX, workLeft), workRight - size.width);
            targetY = Math.min(Math.max(targetY, workTop), workBottom - size.height);

            const nextStageViewportLeft = edge === 'left'
              ? 0
              : edge === 'right'
                ? window.innerWidth - STAGE_SIZE
                : stageLeft / drag.scale - targetX / drag.scale;
            const nextStageViewportTop = edge === 'top'
              ? 0
              : edge === 'bottom'
                ? window.innerHeight - STAGE_SIZE
                : stageTop / drag.scale - targetY / drag.scale;

            await drag.coreApi.invoke('kanshan_set_snap_edge', { edge });
            await drag.coreApi.invoke('kanshan_set_stage_position', {
              x: nextStageViewportLeft * drag.scale,
              y: nextStageViewportTop * drag.scale,
            });

            await drag.appWindow.setPosition(new drag.windowApi.PhysicalPosition(
              Math.round(targetX),
              Math.round(targetY),
            ));
          } catch (error) {
            console.warn('[kanshan] failed to snap desktop window', error);
          }
        })();
        return;
      }

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
        className={`glb-stage${desktopMode ? ' glb-stage--desktop' : ''}${isStageDragging ? ' is-dragging' : ''}`}
        data-snap-edge={desktopMode ? snapEdge : undefined}
        aria-label="刘看山 GLB 模型 Three.js 预览"
        style={desktopMode ? desktopStageStyle : { left: stagePosition.x, top: stagePosition.y }}
        onPointerDown={handleStageDragStart}
        onPointerMove={handleStageDragMove}
        onPointerUp={handleStageDragEnd}
        onPointerCancel={handleStageDragEnd}
        onPointerEnter={() => {
          clearStageHoverGraceTimer();
          setIsStageHovered(true);
        }}
        onPointerLeave={() => {
          clearStageHoverGraceTimer();
          stageHoverGraceTimerRef.current = window.setTimeout(() => {
            setIsStageHovered(false);
            stageHoverGraceTimerRef.current = null;
          }, INTERACTION_GRACE_MS);
        }}
      >
        <span className="stage-ground-shadow" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="glb-canvas"
        />
        <p className="stage-credit">基于@刘看山 二创</p>
        <BubbleDialogue
          actionDialogueText={actionDialogueText}
          bubbleMode={bubbleMode}
          chatDialoguePageIndex={chatDialoguePageIndex}
          chatDialoguePages={chatDialoguePages}
          chatShellRef={chatShellRef}
          isDialogueStreaming={isDialogueStreaming}
          onDialogueHoverChange={handleDialogueHoverChange}
          onChatDialoguePageIndexChange={setChatDialoguePageIndex}
          snapEdge={snapEdge}
        />
        <KanshanHoverMenu
          chatInput={chatInput}
          activeMenuItem={activeMenuItem}
          isActive={isMenuActive}
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
          onPointerDown={(event) => {
            event.stopPropagation();
            handleDirectionDragStart(event);
          }}
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
  chatShellRef: React.MutableRefObject<HTMLDivElement | null>;
  isDialogueStreaming: boolean;
  onChatDialoguePageIndexChange: React.Dispatch<React.SetStateAction<number>>;
  onDialogueHoverChange: (hovered: boolean) => void;
  snapEdge: PetSnapEdge;
}

function BubbleDialogue({
  actionDialogueText,
  bubbleMode,
  chatDialoguePageIndex,
  chatDialoguePages,
  chatShellRef,
  isDialogueStreaming,
  onChatDialoguePageIndexChange,
  onDialogueHoverChange,
  snapEdge,
}: BubbleDialogueProps) {
  const hasTrimmedDialogue = bubbleMode === 'chat' && chatDialoguePages.length > 1;
  const resolvedDialogueText = bubbleMode === 'chat'
    ? (chatDialoguePages[chatDialoguePageIndex] ?? chatDialoguePages.at(-1) ?? '')
    : actionDialogueText;
  const displayedChatDialogueText = resolvedDialogueText
    || (isDialogueStreaming ? '看山正在回复…' : CHAT_DIALOGUE_EMPTY_TEXT);
  const canPageUp = hasTrimmedDialogue && chatDialoguePageIndex > 0;
  const canPageDown = hasTrimmedDialogue && chatDialoguePageIndex < chatDialoguePages.length - 1;

  const isChatBubble = bubbleMode === 'chat';

  return (
    <div
      className={`pet-dialogue-bubble pet-dialogue-bubble--${resolveDialoguePlacement(snapEdge)} pet-dialogue-bubble--${bubbleMode}`}
      role="status"
      aria-live="polite"
      onPointerEnter={() => onDialogueHoverChange(true)}
      onPointerLeave={() => onDialogueHoverChange(false)}
    >
      {isChatBubble ? (
        <div className="pet-dialogue-chat-shell" ref={chatShellRef}>
          <span className={`pet-dialogue-content pet-dialogue-content--chat${resolvedDialogueText ? '' : ' is-empty'}`}>
            {displayedChatDialogueText}
            {isDialogueStreaming && !canPageDown ? <i className="pet-dialogue-caret" aria-hidden="true">▍</i> : null}
          </span>
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
  chatInput: string;
  isActive: boolean;
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
  chatInput,
  isActive,
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
  const closeMenuTimerRef = useRef<number | null>(null);

  const clearCloseMenuTimer = () => {
    if (closeMenuTimerRef.current === null) return;
    window.clearTimeout(closeMenuTimerRef.current);
    closeMenuTimerRef.current = null;
  };

  const closeSubmenu = () => {
    onActiveMenuItemChange(null);
    onOpenPanelChange(null);
  };

  useEffect(() => clearCloseMenuTimer, []);

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

  const handleZhidaLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('kanshan_open_external_url', { url: ZHIDA_AI_URL });
      } catch {
        window.open(ZHIDA_AI_URL, '_blank', 'noopener,noreferrer');
      }
    })();
  };

  const closeMenuForPointerLeave = () => {
    onMenuHoverChange(false);
    clearCloseMenuTimer();
    closeMenuTimerRef.current = window.setTimeout(() => {
      onChatFocusChange(false);
      onActiveMenuItemChange(null);
      onOpenPanelChange(null);
      closeMenuTimerRef.current = null;
    }, INTERACTION_GRACE_MS);
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
        onPointerEnter={() => {
          clearCloseMenuTimer();
          onMenuHoverChange(true);
        }}
        onPointerLeave={closeMenuForPointerLeave}
      >
        <div className="pet-menu-actions">
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
              <a
                className="pet-chat-status pet-chat-link"
                href={ZHIDA_AI_URL}
                rel="noreferrer"
                target="_blank"
                onClick={handleZhidaLinkClick}
              >
                去知乎直答
              </a>
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
