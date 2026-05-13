import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { PetAction } from '@kanshan/bridge';
import {
  kanshanActionMeta,
  formatKanshanActionClip,
  kanshanRawClipConfig,
  kanshanSemanticClipNames,
  resolveKanshanClipName,
  previewActionGroups,
} from './kanshanActionConfig';
import {
  consumeKanshanAuthRedirect,
  consumeKanshanDesktopAuthURL,
  fetchKanshanDefaultState,
  fetchKanshanPetSnapshot,
  fetchKanshanProps,
  fetchKanshanTasks,
  fetchCurrentKanshanUser,
  getStoredKanshanUser,
  isKanshanOAuthMode,
  petSnapshotToDefaultState,
  petSnapshotToStats,
  progressKanshanTask,
  interactKanshan,
  signOutKanshan,
  startZhihuLogin,
  storeKanshanSession,
  useKanshanProp,
  type KanshanDefaultState,
  type KanshanCurrentUser,
  type KanshanPropItem,
  type KanshanPetStats,
  type KanshanTaskItem,
} from './kanshanMenuData';
import { kanshanModelConfig } from './kanshanModelConfig';
import { KanshanModelPreview, openExternalUrl, type KanshanModelPreviewHandle, type KanshanRewardToast } from './KanshanModelPreview';
import { OverviewPage } from './pages/OverviewPage';
import {
  chooseKanshanMarketReactionAction,
  pickKanshanMarketDialogueCandidate,
  connectKanshanMarketStream,
} from './kanshanMarketStream';
import { fetchChatHistory, streamChat } from './chatService';

type MenuDataStatus = 'idle' | 'loading' | 'ready' | 'error';
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'redirecting';
type RewardToast = KanshanRewardToast;
type DialogueSource = 'chat' | 'market';

const DEFAULT_STATE_POLL_MS = 10000;
const TEMPORARY_ACTION_MIN_MS = 1800;
const CHAT_TYPING_INTERVAL_MS = 80;
const CHAT_TYPING_BATCH_SIZE = 2;
const CHAT_MARKET_DIALOGUE_COOLDOWN_MS = 15000;
const MARKET_DIALOGUE_VISIBLE_MS = 13000;
const IS_DESKTOP_MODE = import.meta.env.MODE === 'desktop' || import.meta.env.VITE_KANSHAN_DESKTOP === 'true';
const SHOULD_REQUIRE_AUTH = isKanshanOAuthMode();

interface KanshanAuthMessage {
  type?: string;
  session?: Parameters<typeof storeKanshanSession>[0];
}

function resolveActionHint(actionHint: string): PetAction | null {
  if (actionHint === 'happy-temporary') return 'happy';
  if (actionHint === 'exercise-temporary') return 'run';
  if (actionHint === 'recover') return 'happy';
  if (actionHint === 'revive') return 'revive';
  return null;
}

export function App() {
  const { pathname } = useLocation();
  const embedInPanel = !IS_DESKTOP_MODE && pathname === '/';
  const previewRef = useRef<KanshanModelPreviewHandle | null>(null);
  const [defaultAction, setDefaultAction] = useState<PetAction>('idle');
  const defaultActionRef = useRef<PetAction>('idle');
  const [activeAction, setActiveAction] = useState<PetAction>('idle');
  const [actionRevision, setActionRevision] = useState(0);
  const defaultStateTimerRef = useRef<number | null>(null);
  const temporaryFallbackTimerRef = useRef<number | null>(null);
  const temporaryActionRef = useRef<{ token: number; minEndAt: number } | null>(null);
  const isFollowingDefaultRef = useRef(true);
  const [isDead, setIsDead] = useState(false);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [propItems, setPropItems] = useState<KanshanPropItem[]>([]);
  const [taskItems, setTaskItems] = useState<KanshanTaskItem[]>([]);
  const [petStats, setPetStats] = useState<KanshanPetStats | null>(null);
  const [petLifecycle, setPetLifecycle] = useState('normal');
  const [menuDataStatus, setMenuDataStatus] = useState<MenuDataStatus>('idle');
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => (SHOULD_REQUIRE_AUTH ? 'checking' : 'authenticated'));
  const [currentUser, setCurrentUser] = useState<KanshanCurrentUser | null>(() => getStoredKanshanUser());
  const [rewardToast, setRewardToast] = useState<RewardToast>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatError, setChatError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState('');
  const [marketDialogueText, setMarketDialogueText] = useState('');
  const [marketDialogueUrl, setMarketDialogueUrl] = useState<string | undefined>(undefined);
  const [dialogueSource, setDialogueSource] = useState<DialogueSource>('market');
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const chatDisplayTimerRef = useRef<number | null>(null);
  const marketDialogueTimerRef = useRef<number | null>(null);
  const pendingChatTextRef = useRef('');
  const visibleChatTextRef = useRef('');
  const isChatStreamDoneRef = useRef(false);
  const isSendingRef = useRef(false);
  const chatInputRef = useRef('');
  const lastChatInteractionAtRef = useRef(0);
  const playActionRef = useRef<(action: PetAction) => void>(() => {});
  const semanticClipRows = kanshanRawClipConfig.map((item) => ({
    semanticClipName: item.label,
    rawClipName: item.clipName,
    note: item.note,
  }));
  const rawClipNameSet = new Set(clipNames);
  const missingSemanticClipNames = kanshanSemanticClipNames.filter((clipName) => !rawClipNameSet.has(resolveKanshanClipName(clipName)));

  useEffect(() => {
    if (!IS_DESKTOP_MODE) return;

    document.documentElement.classList.add('kanshan-desktop-mode');
    document.body.classList.add('kanshan-desktop-mode');

    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('contextmenu', preventContextMenu);

    return () => {
      window.removeEventListener('contextmenu', preventContextMenu);
      document.documentElement.classList.remove('kanshan-desktop-mode');
      document.body.classList.remove('kanshan-desktop-mode');
    };
  }, []);

  useEffect(() => {
    const redirectedUser = consumeKanshanAuthRedirect();
    const storedUser = getStoredKanshanUser();
    if (redirectedUser || storedUser) {
      setCurrentUser(redirectedUser || storedUser);
      setAuthStatus('authenticated');
      return;
    }

    if (!SHOULD_REQUIRE_AUTH) {
      setAuthStatus('authenticated');
      return;
    }

    let isCurrent = true;
    fetchCurrentKanshanUser()
      .then((user) => {
        if (!isCurrent) return;
        if (user) {
          setCurrentUser(user);
          setAuthStatus('authenticated');
          return;
        }
        setAuthStatus('unauthenticated');
      })
      .catch(() => {
        if (!isCurrent) return;
        setAuthStatus('unauthenticated');
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent<KanshanAuthMessage>) => {
      if (event.data?.type !== 'kanshan:auth' || !event.data.session) return;
      setCurrentUser(storeKanshanSession(event.data.session));
      setAuthStatus('authenticated');
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isDisposed = false;

    if (!IS_DESKTOP_MODE) return undefined;

    const consumeDesktopAuthURL = (url: string | null | undefined) => {
      if (!url) return;
      console.info('[kanshan] desktop auth callback received', url);
      const user = consumeKanshanDesktopAuthURL(url);
      if (user) {
        setCurrentUser(user);
        setAuthStatus('authenticated');
      } else {
        console.warn('[kanshan] desktop auth callback ignored', url);
      }
    };

    void Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core'), import('@tauri-apps/plugin-deep-link')])
      .then(async ([eventApi, coreApi, deepLinkApi]) => {
        const dispose = await eventApi.listen<string>('kanshan://auth-callback', ({ payload }) => {
          consumeDesktopAuthURL(payload);
        });

        const pendingURL = await coreApi.invoke<string | null>('kanshan_take_auth_callback_url');
        consumeDesktopAuthURL(pendingURL);

        const currentURLs = await deepLinkApi.getCurrent();
        currentURLs?.forEach(consumeDesktopAuthURL);

        const disposeDeepLink = await deepLinkApi.onOpenUrl((urls) => {
          urls.forEach(consumeDesktopAuthURL);
        });

        if (isDisposed) {
          dispose();
          disposeDeepLink();
          return;
        }
        unlisten = () => {
          dispose();
          disposeDeepLink();
        };
      })
      .catch(() => {});

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP_MODE || authStatus !== 'authenticated') return;
    let isCurrent = true;
    fetchChatHistory()
      .then((turns) => {
        if (!isCurrent) return;
        const latestTurn = turns.at(-1);
        if (!latestTurn) return;
        setLastUserMessage(latestTurn.query);
        setChatText(latestTurn.answer);
        setDialogueSource('chat');
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [authStatus]);

  useEffect(() => {
    let unlistenSignOut: (() => void) | null = null;
    let isDisposed = false;

    if (!IS_DESKTOP_MODE) return undefined;

    void import('@tauri-apps/api/event')
      .then(async (eventApi) => {
        const disposeSignOut = await eventApi.listen('kanshan://sign-out', () => {
          signOutKanshan();
          setCurrentUser(null);
          setAuthStatus(SHOULD_REQUIRE_AUTH ? 'unauthenticated' : 'authenticated');
          setPropItems([]);
          setTaskItems([]);
          setMenuDataStatus('idle');
        });
        if (isDisposed) {
          disposeSignOut();
          return;
        }
        unlistenSignOut = disposeSignOut;
      })
      .catch(() => {});

    return () => {
      isDisposed = true;
      unlistenSignOut?.();
    };
  }, []);

  const handleLogin = useCallback(() => {
    setAuthStatus('redirecting');
    void startZhihuLogin().catch(() => setAuthStatus('unauthenticated'));
  }, []);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    chatInputRef.current = chatInput;
  }, [chatInput]);

  const clearTemporaryFallbackTimer = useCallback(() => {
    if (temporaryFallbackTimerRef.current === null) return;

    window.clearTimeout(temporaryFallbackTimerRef.current);
    temporaryFallbackTimerRef.current = null;
  }, []);

  const clearDefaultStateTimer = useCallback(() => {
    if (defaultStateTimerRef.current === null) return;

    window.clearTimeout(defaultStateTimerRef.current);
    defaultStateTimerRef.current = null;
  }, []);

  const clearChatDisplayTimer = useCallback(() => {
    if (chatDisplayTimerRef.current === null) return;

    window.clearTimeout(chatDisplayTimerRef.current);
    chatDisplayTimerRef.current = null;
  }, []);

  const clearMarketDialogueTimer = useCallback(() => {
    if (marketDialogueTimerRef.current === null) return;

    window.clearTimeout(marketDialogueTimerRef.current);
    marketDialogueTimerRef.current = null;
  }, []);

  const clearMarketDialogue = useCallback(() => {
    clearMarketDialogueTimer();
    setMarketDialogueText('');
    setMarketDialogueUrl(undefined);
  }, [clearMarketDialogueTimer]);

  useEffect(() => {
    if (authStatus === 'authenticated') return;
    clearMarketDialogue();
  }, [authStatus, clearMarketDialogue]);

  const flushChatDisplay = useCallback(() => {
    clearChatDisplayTimer();

    const step = () => {
      if (pendingChatTextRef.current.length === 0) {
        chatDisplayTimerRef.current = null;
        return;
      }

      const nextChunk = pendingChatTextRef.current.slice(0, CHAT_TYPING_BATCH_SIZE);
      pendingChatTextRef.current = pendingChatTextRef.current.slice(CHAT_TYPING_BATCH_SIZE);
      visibleChatTextRef.current += nextChunk;
      setChatText(visibleChatTextRef.current);

      if (pendingChatTextRef.current.length === 0) {
        chatDisplayTimerRef.current = null;
        return;
      }

      chatDisplayTimerRef.current = window.setTimeout(step, CHAT_TYPING_INTERVAL_MS);
    };

    step();
  }, [clearChatDisplayTimer]);

  const enqueueChatText = useCallback((chunk: string) => {
    if (!chunk) return;
    pendingChatTextRef.current += chunk;
    if (chatDisplayTimerRef.current === null) {
      flushChatDisplay();
    }
  }, [flushChatDisplay]);

  const applyMarketDialogue = useCallback((nextText: string, nextUrl?: string) => {
    if (!nextText.trim()) return;
    clearMarketDialogueTimer();
    setMarketDialogueText(nextText);
    setMarketDialogueUrl(nextUrl);
    setDialogueSource('market');
    marketDialogueTimerRef.current = window.setTimeout(() => {
      setMarketDialogueText('');
      setMarketDialogueUrl(undefined);
      marketDialogueTimerRef.current = null;
    }, MARKET_DIALOGUE_VISIBLE_MS);
  }, [clearMarketDialogueTimer]);

  const applyDefaultState = useCallback((nextDefaultState: KanshanDefaultState) => {
    isFollowingDefaultRef.current = true;
    defaultActionRef.current = nextDefaultState.action;
    setPetLifecycle(nextDefaultState.lifecycle);
    setDefaultAction(nextDefaultState.action);
    setActiveAction(nextDefaultState.action);
    setActionRevision((current) => current + 1);
    if (nextDefaultState.action === 'idle') setIsDead(false);
  }, []);

  const refreshPetStats = useCallback(async () => {
    const snapshot = await fetchKanshanPetSnapshot();
    setPetLifecycle(snapshot.lifecycle);
    setPetStats(petSnapshotToStats(snapshot));
    return snapshot;
  }, []);

  const fetchAndStoreDefaultState = useCallback(async () => {
    const nextDefaultState = await fetchKanshanDefaultState();
    defaultActionRef.current = nextDefaultState.action;
    setPetLifecycle(nextDefaultState.lifecycle);
    setDefaultAction(nextDefaultState.action);
    if (nextDefaultState.action === 'idle') setIsDead(false);
    return nextDefaultState;
  }, []);

  const fetchAndApplyDefaultState = useCallback(async () => {
    const nextDefaultState = await fetchKanshanDefaultState();
    applyDefaultState(nextDefaultState);
    const hintedAction = resolveActionHint(nextDefaultState.actionHint ?? '');
    if (hintedAction) playActionRef.current(hintedAction);
    void refreshPetStats().catch(() => {});
    return nextDefaultState;
  }, [applyDefaultState, refreshPetStats]);

  const scheduleDefaultStatePoll = useCallback(() => {
    clearDefaultStateTimer();
    defaultStateTimerRef.current = window.setTimeout(() => {
      if (temporaryActionRef.current) {
        scheduleDefaultStatePoll();
        return;
      }

      fetchAndStoreDefaultState()
        .then((nextDefaultState) => {
          if (isFollowingDefaultRef.current) {
            applyDefaultState(nextDefaultState);
            const hintedAction = resolveActionHint(nextDefaultState.actionHint ?? '');
            if (hintedAction) playActionRef.current(hintedAction);
          }
        })
        .finally(scheduleDefaultStatePoll);
    }, DEFAULT_STATE_POLL_MS);
  }, [applyDefaultState, clearDefaultStateTimer, fetchAndStoreDefaultState]);

  const loadMenuData = useCallback(() => {
    let isCurrent = true;

    setMenuDataStatus('loading');
    Promise.allSettled([fetchKanshanProps(), fetchKanshanTasks(), fetchKanshanDefaultState(), fetchKanshanPetSnapshot()])
      .then(([propsResult, tasksResult, defaultStateResult, petStateResult]) => {
        if (!isCurrent) return;

        if (propsResult.status === 'fulfilled') setPropItems(propsResult.value);
        if (tasksResult.status === 'fulfilled') setTaskItems(tasksResult.value);
        if (defaultStateResult.status === 'fulfilled') {
          applyDefaultState(defaultStateResult.value);
          const hintedAction = resolveActionHint(defaultStateResult.value.actionHint ?? '');
          if (hintedAction) playActionRef.current(hintedAction);
        }
        if (petStateResult.status === 'fulfilled') {
          setPetLifecycle(petStateResult.value.lifecycle);
          setPetStats(petSnapshotToStats(petStateResult.value));
        }

        setMenuDataStatus(propsResult.status === 'fulfilled' || tasksResult.status === 'fulfilled' ? 'ready' : 'error');
      });

    return () => {
      isCurrent = false;
    };
  }, [applyDefaultState]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    return loadMenuData();
  }, [authStatus, loadMenuData]);

  useEffect(() => {
    if (authStatus === 'authenticated') scheduleDefaultStatePoll();
    return () => {
      chatAbortControllerRef.current?.abort();
      clearChatDisplayTimer();
      clearDefaultStateTimer();
      if (authStatus !== 'authenticated') clearMarketDialogue();
      clearTemporaryFallbackTimer();
    };
  }, [authStatus, clearChatDisplayTimer, clearDefaultStateTimer, clearMarketDialogue, clearTemporaryFallbackTimer, scheduleDefaultStatePoll]);

  const playAction = useCallback((action: PetAction) => {
    const meta = kanshanActionMeta[action];
    if (isDead && action !== 'revive') return;
    if (meta?.onlyWhenDead && !isDead) return;

    isFollowingDefaultRef.current = false;
    if (meta?.duration === 'temporary') {
      clearTemporaryFallbackTimer();
      temporaryActionRef.current = { token: Date.now(), minEndAt: Date.now() + TEMPORARY_ACTION_MIN_MS };
    } else {
      clearTemporaryFallbackTimer();
      temporaryActionRef.current = null;
    }
    setActiveAction(action);
    setActionRevision((current) => current + 1);
    if (meta?.terminal) setIsDead(true);
    if (action === 'revive') setIsDead(false);
  }, [clearTemporaryFallbackTimer, isDead]);

  useEffect(() => {
    playActionRef.current = playAction;
  }, [playAction]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let isCurrent = true;
    const stop = connectKanshanMarketStream({
      onSnapshot(snapshot) {
        if (!isCurrent) return;
        const candidate = pickKanshanMarketDialogueCandidate(snapshot);
        const nextText = candidate ? `看山播报：${candidate.text}` : snapshot.summary.trim() ? `看山播报：${snapshot.summary.trim()}` : '';
        if (!nextText) return;
        const isChatCoolingDown = Date.now() - lastChatInteractionAtRef.current < CHAT_MARKET_DIALOGUE_COOLDOWN_MS;
        if (isSendingRef.current || chatInputRef.current.trim().length > 0 || isChatCoolingDown) {
          return;
        }
        applyMarketDialogue(nextText, candidate?.url);
        playAction(chooseKanshanMarketReactionAction(snapshot));
      },
    });
    return () => {
      isCurrent = false;
      stop();
    };
  }, [applyMarketDialogue, authStatus, playAction]);

  const returnToLocalDefaultAction = useCallback(() => {
    const action = defaultActionRef.current;
    isFollowingDefaultRef.current = true;
    setActiveAction(action);
    setActionRevision((current) => current + 1);
    if (action === 'idle') setIsDead(false);
  }, []);

  const finishTemporaryAction = useCallback((force = false) => {
    const temporaryAction = temporaryActionRef.current;
    if (!temporaryAction) return;

    const remainingMs = temporaryAction.minEndAt - Date.now();
    if (!force && remainingMs > 0) {
      clearTemporaryFallbackTimer();
      const temporaryToken = temporaryAction.token;
      temporaryFallbackTimerRef.current = window.setTimeout(() => {
        if (temporaryActionRef.current?.token !== temporaryToken) return;
        temporaryActionRef.current = null;
        returnToLocalDefaultAction();
        fetchAndApplyDefaultState().finally(scheduleDefaultStatePoll);
      }, remainingMs);
      return;
    }

    clearTemporaryFallbackTimer();
    temporaryActionRef.current = null;
    returnToLocalDefaultAction();
    fetchAndApplyDefaultState().finally(scheduleDefaultStatePoll);
  }, [clearTemporaryFallbackTimer, fetchAndApplyDefaultState, returnToLocalDefaultAction, scheduleDefaultStatePoll]);

  const playDefaultAction = useCallback(() => {
    finishTemporaryAction();
  }, [finishTemporaryAction]);

  const handleTemporaryActionStart = useCallback(() => {
    isFollowingDefaultRef.current = false;
    clearTemporaryFallbackTimer();
    temporaryActionRef.current = { token: Date.now(), minEndAt: Date.now() + TEMPORARY_ACTION_MIN_MS };
    return true;
  }, [clearTemporaryFallbackTimer]);

  const handlePatStart = useCallback(() => {
    handleTemporaryActionStart();
    void interactKanshan('pat').catch(() => setMenuDataStatus('error'));
  }, [handleTemporaryActionStart]);

  const playRawClip = useCallback((clipName: string) => {
    isFollowingDefaultRef.current = false;
    clearTemporaryFallbackTimer();
    temporaryActionRef.current = null;
    previewRef.current?.playRawClip(clipName);
  }, [clearTemporaryFallbackTimer]);

  const handleActionEnd = useCallback((action: PetAction) => {
    const meta = kanshanActionMeta[action];
    if (meta?.duration !== 'temporary' || meta.terminal) return;

    finishTemporaryAction(true);
  }, [finishTemporaryAction]);

  const showRewardToast = useCallback((reward: Exclude<RewardToast, null>) => {
    setRewardToast(null);
    window.setTimeout(() => setRewardToast(reward), 0);
  }, []);

  const refreshTasksAndPropsAfterProgress = useCallback(async (rewardsGranted: Array<{ kind: string; itemId?: string; qty?: number }>) => {
    const [nextTaskItems, nextPropItems] = await Promise.all([
      fetchKanshanTasks(),
      rewardsGranted.length > 0 ? fetchKanshanProps() : Promise.resolve(propItems),
    ]);
    setTaskItems(nextTaskItems);
    setPropItems(nextPropItems);
    setMenuDataStatus('ready');
  }, [propItems]);

  const handleSelectProp = useCallback((item: KanshanPropItem) => {
    if (item.count <= 0) return;
    showRewardToast({ label: item.name, icon: { propId: item.id } });
    void useKanshanProp(item.id)
      .then(async ({ actionHint, newState }) => {
        const hintedAction = resolveActionHint(actionHint);
        if (newState) {
          setPetLifecycle(newState.lifecycle);
          applyDefaultState(petSnapshotToDefaultState(newState));
        } else if (!hintedAction) {
          await fetchAndApplyDefaultState();
        }
        if (hintedAction) playAction(hintedAction);

        const shouldProgressFeedTask = item.id === 'fish-jerky' || item.id === 'nutrition-can';
        if (shouldProgressFeedTask) {
          await progressKanshanTask('feed-2-times');
        }
        const [nextPropItems, nextTaskItems] = await Promise.all([
          fetchKanshanProps(),
          shouldProgressFeedTask ? fetchKanshanTasks() : Promise.resolve(taskItems),
        ]);
        setPropItems(nextPropItems);
        if (shouldProgressFeedTask) setTaskItems(nextTaskItems);
        await refreshPetStats().catch(() => {});
        setMenuDataStatus('ready');
      })
      .catch(() => setMenuDataStatus('error'));
  }, [applyDefaultState, fetchAndApplyDefaultState, playAction, refreshPetStats, showRewardToast, taskItems]);

  const handleSelectTask = useCallback((item: KanshanTaskItem) => {
    if (item.action === 'disabled' || item.availableCount >= item.totalCount) return;
    void progressKanshanTask(item.id)
      .then(async ({ rewardsGranted, actionHint, newState }) => {
        if (newState) applyDefaultState(petSnapshotToDefaultState(newState));
        const hintedAction = resolveActionHint(actionHint);
        if (hintedAction) playAction(hintedAction);
        await refreshTasksAndPropsAfterProgress(rewardsGranted);
        await refreshPetStats().catch(() => {});
        if (item.action === 'open-url' && item.url) {
          await openExternalUrl(item.url);
        }
      })
      .catch(() => setMenuDataStatus('error'));
  }, [applyDefaultState, playAction, refreshPetStats, refreshTasksAndPropsAfterProgress]);

  const submitChat = useCallback(async () => {
    const message = chatInput.trim();
    if (!message || isSending) return;

    chatAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    clearChatDisplayTimer();
    pendingChatTextRef.current = '';
    visibleChatTextRef.current = '';
    isChatStreamDoneRef.current = false;
    lastChatInteractionAtRef.current = Date.now();
    setIsSending(true);
    setDialogueSource('chat');
    setChatError('');
    setChatText('');
    setLastUserMessage(message);

    try {
      pendingChatTextRef.current = '';
      visibleChatTextRef.current = '';
      isChatStreamDoneRef.current = false;

      const streamHandlers = {
        onChunk(chunk: string) {
          enqueueChatText(chunk);
        },
        onDone(fullText: string) {
          isChatStreamDoneRef.current = true;
          pendingChatTextRef.current = fullText.slice(visibleChatTextRef.current.length) + pendingChatTextRef.current;
          if (chatDisplayTimerRef.current === null) {
            flushChatDisplay();
          }
        },
      };

      await streamChat(message, streamHandlers, { signal: abortController.signal });
      try {
        const { rewardsGranted } = await progressKanshanTask('chat-1-time');
        await refreshTasksAndPropsAfterProgress(rewardsGranted);
        await refreshPetStats().catch(() => {});
      } catch {
        setMenuDataStatus('error');
      }
      setChatInput('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      clearChatDisplayTimer();
      pendingChatTextRef.current = '';
      setChatError(message || '对话暂时失败了，请稍后再试。');
      setChatText((current) => current || message || '我刚才没听清，再说一次。');
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }

      const waitForTypingToFinish = () => {
        if (pendingChatTextRef.current.length > 0 || chatDisplayTimerRef.current !== null) {
          window.setTimeout(waitForTypingToFinish, CHAT_TYPING_INTERVAL_MS);
          return;
        }

        lastChatInteractionAtRef.current = Date.now();
        setIsSending(false);
      };

      waitForTypingToFinish();
    }
  }, [chatInput, isSending, refreshPetStats, refreshTasksAndPropsAfterProgress]);

  const handleChatInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submitChat();
  }, [submitChat]);

  const shellClass = IS_DESKTOP_MODE ? 'glb-shell glb-shell--desktop' : 'glb-shell';
  const resolvedDialogueText = authStatus === 'authenticated' ? (dialogueSource === 'market' ? marketDialogueText : chatText) : '';
  const resolvedIsDialogueStreaming = authStatus === 'authenticated' && dialogueSource === 'chat' && isSending;

  const kanshanModelPreview = (
    <KanshanModelPreview
      embedInPanel={embedInPanel}
      chatError={chatError}
      chatInput={chatInput}
      desktopMode={IS_DESKTOP_MODE}
      dialogueLinkUrl={authStatus === 'authenticated' && dialogueSource === 'market' ? marketDialogueUrl : undefined}
      dialogueSource={dialogueSource}
      dialogueText={resolvedDialogueText}
      isDialogueStreaming={resolvedIsDialogueStreaming}
      lastUserMessage={lastUserMessage}
      ref={previewRef}
      actionRevision={actionRevision}
      activeAction={activeAction}
      menuDataStatus={menuDataStatus}
      rewardToast={rewardToast}
      modelUrl={kanshanModelConfig.url}
      needsLogin={authStatus !== 'authenticated'}
      ownerName={currentUser?.name}
      petLifecycle={petLifecycle}
      petStats={petStats}
      propItems={propItems}
      taskItems={taskItems}
      onActionEnd={handleActionEnd}
      onPatStart={handlePatStart}
      onPatEnd={playDefaultAction}
      onClipNamesChange={setClipNames}
      onLogin={handleLogin}
      onRetryMenuData={loadMenuData}
      onSelectProp={handleSelectProp}
      onSelectTask={handleSelectTask}
      onChatInputChange={setChatInput}
      onChatInputKeyDown={handleChatInputKeyDown}
      onChatSubmit={() => void submitChat()}
    />
  );

  if (IS_DESKTOP_MODE) {
    return <main className={shellClass}>{kanshanModelPreview}</main>;
  }

  return (
    <Routes>
      <Route path="/" element={
        <OverviewPage
          shellClass={shellClass}
          onPlayAction={playAction}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onChatSubmit={() => void submitChat()}
          onChatInputKeyDown={handleChatInputKeyDown}
          isSending={isSending}
          chatText={resolvedDialogueText}
          lastUserMessage={lastUserMessage}
          chatError={chatError}
        >
          {kanshanModelPreview}
        </OverviewPage>
      } />
      <Route
        path="/debug"
        element={
          <main className={shellClass}>
            {kanshanModelPreview}
            {!IS_DESKTOP_MODE ? (
              <section className="glb-main-panel">
                <p className="eyebrow">Three.js GLB Preview</p>
                <h1>模型和动作都由配置控制。</h1>
                <p>
                  当前页面加载 <code>{kanshanModelConfig.fileName}</code>。语义动作走配置映射，原始 clip 面板直接播放 GLB 内动画。
                </p>
                <section className="preview-panel">
                  <h2>语义动作</h2>
                  {previewActionGroups.map((group) => (
                    <section key={group.title} className="action-group">
                      <h3>{group.title}</h3>
                      <div className="glb-actions" aria-label={group.title}>
                        {group.actions.map((item) => {
                          const disabled = (isDead && item.action !== 'revive') || Boolean(item.onlyWhenDead && !isDead);
                          return (
                            <button
                              key={item.action}
                              className={item.action === activeAction ? 'is-active' : ''}
                              disabled={disabled}
                              type="button"
                              onClick={() => playAction(item.action)}
                            >
                              {item.label}
                              <span className="action-strategy" role="tooltip">
                                {item.duration} · {item.repetitions ? item.repetitions + '轮' : item.loop ? '循环' : '单次'} ·{' '}
                                {item.clips.map(formatKanshanActionClip).join(' / ')}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  <p className="state-note">
                    当前状态：<code>{isDead ? '死亡，只允许复活' : activeAction}</code>
                  </p>
                  {missingSemanticClipNames.length > 0 ? (
                    <p className="state-note">未映射语义 clip：<code>{missingSemanticClipNames.join(' / ')}</code></p>
                  ) : null}
                </section>
                <section className="preview-panel">
                  <h2>语义 clip 对照</h2>
                  <p className="clip-note">按钮显示语义 clip。点击后通过映射表播放真实 GLB clip。</p>
                  <div className="raw-clip-list" aria-label="原始 GLB clip">
                    {clipNames.length === 0 ? (
                      <span>等待 GLB clip 列表。</span>
                    ) : (
                      semanticClipRows.map((item, index) => {
                        const hasRawClip = rawClipNameSet.has(item.rawClipName);
                        return (
                          <div key={item.semanticClipName} className="raw-clip-row">
                            <span className="raw-clip-index">{index}</span>
                            <button
                              type="button"
                              title={item.note}
                              disabled={!hasRawClip}
                              onClick={() => playRawClip(item.rawClipName)}
                            >
                              {item.semanticClipName}
                              {item.note ? <small>{item.note}</small> : null}
                            </button>
                            <code>
                              {item.semanticClipName} =&gt; {hasRawClip ? item.rawClipName : '缺失'}
                            </code>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </section>
            ) : null}
          </main>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
