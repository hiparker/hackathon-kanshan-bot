import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import type { PetAction } from '@kanshan/bridge';
import { Link } from 'react-router-dom';
import UnicornScene from 'unicornstudio-react';

const MAC_ARM_DOWNLOAD_URL = 'https://upload.bedebug.com/hackathon-2026/kanshan-darwin-aarch64.zip';
const WINDOWS_DOWNLOAD_URL = 'https://upload.bedebug.com/hackathon-2026/kanshan-exe.zip';

export interface OverviewPageProps {
  shellClass: string;
  children: ReactNode;
  onPlayAction?: (action: PetAction) => void;
  chatInput?: string;
  onChatInputChange?: (value: string) => void;
  onChatSubmit?: () => void;
  onChatInputKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isSending?: boolean;
  chatText?: string;
  lastUserMessage?: string;
  chatError?: string;
}

const APP_VERSION = '0.1.0';

function IconDownload() {
  return (
    <svg className="overview-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1zm-7 14a1 1 0 0 1 1 1v2h14v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"
      />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg className="overview-icon overview-icon--accent" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"
      />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg className="overview-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-4a1 1 0 0 1-1-1V4zM8 18h8v-2H8v2zm0-4h8v-2H8v2zm0-4h5v-2H8v2z"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="overview-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4h12v2H6V8zm0 4h8v2H6v-2z"
      />
    </svg>
  );
}

function IconGithub() {
  return (
    <svg className="overview-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
      />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg className="overview-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="overview-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
      />
    </svg>
  );
}

/** 仪表盘总览：左侧信息与动态，右侧统计与资源，右下角嵌入桌宠预览 */
export function OverviewPage({
  shellClass,
  children,
  onPlayAction,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  onChatInputKeyDown,
  isSending,
  chatText,
  lastUserMessage,
  chatError,
}: OverviewPageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState('Mac 版 (Apple Silicon)');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options = [
    { label: 'Mac 版 (Apple Silicon)', ext: '.zip', url: MAC_ARM_DOWNLOAD_URL },
    { label: 'Mac 版 (Intel)', ext: '.dmg', url: 'https://github.com/hiparker/hackathon-kanshan-bot/releases/download/v1.0.10/_1.0.4_x64.dmg' },
    { label: 'Windows 版', ext: '.zip', url: WINDOWS_DOWNLOAD_URL },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <main className={`${shellClass} glb-shell--overview`}>
      <div className="overview-awareness-bg" aria-hidden="true">
        <UnicornScene
          jsonFilePath="/unicorn-scene.json"
          production
          lazyLoad
          dpi={1}
          fps={30}
          scale={1}
          width="100%"
          height="100%"
          className="overview-awareness-bg__scene"
          altText="Awareness animated background"
        />
      </div>
      <div className="overview-page">
        <header className="overview-header">
          <div className="overview-header__title-row">
            <h1 className="overview-header__title">今天开始和刘看山同居｜桌面 AI 宠物初体验</h1>
            <span className="overview-tag overview-tag--success">进行中</span>
          </div>
          <p className="overview-header__subtitle">活在你的电脑里，陪伴式状态与道具互动。</p>
          <div className="overview-header__actions">
            <a
              href={MAC_ARM_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="overview-download-primary"
            >
              <IconDownload />
              <span>下载 Mac Apple Silicon 版</span>
              <span className="overview-download-primary__meta">ZIP</span>
            </a>
            <div className="dropdown dropdown--secondary" ref={dropdownRef}>
              <button
                type="button"
                className="dropdown-btn"
                onClick={() => setIsOpen(!isOpen)}
              >
                <span>其他版本</span>
                <IconChevronDown />
              </button>
              {isOpen && (
                <div className="dropdown-menu">
                  {options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setSelected(option.label);
                        setIsOpen(false);
                        window.open(option.url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <span className="dropdown-item-check">
                        {selected === option.label && <IconCheck />}
                      </span>
                      <span>{option.label}</span>
                      <span className="dropdown-item-ext">{option.ext}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a
              href="https://github.com/hiparker/hackathon-kanshan-bot"
              target="_blank"
              rel="noopener noreferrer"
              className="overview-btn overview-btn--secondary"
              style={{ textDecoration: 'none' }}
            >
              <IconGithub />
              <span>在 GitHub 上查看</span>
            </a>
          </div>
          <section className="overview-install" aria-label="Mac 安装步骤">
            <div className="overview-install__lead">
              <span className="overview-install__eyebrow">Mac 内部测试版</span>
              <h2 className="overview-install__title">下载后按 3 步打开刘看山。</h2>
              <p className="overview-install__text">
                当前 ZIP 包未经过 Apple 签名和公证。macOS 可能提示应用已损坏。按下面步骤处理后即可测试。
              </p>
            </div>
            <ol className="overview-install__steps">
              <li>
                <span className="overview-install__num">01</span>
                <span>下载 ZIP 压缩包并解压。</span>
              </li>
              <li>
                <span className="overview-install__num">02</span>
                <span>把 <strong>刘看山.app</strong> 拖入 <strong>应用程序</strong>。</span>
              </li>
              <li>
                <span className="overview-install__num">03</span>
                <span>打开终端，执行下面命令。</span>
              </li>
            </ol>
            <code className="overview-install__command">xattr -d com.apple.quarantine /Applications/刘看山.app</code>
          </section>
        </header>

        <div className="overview-grid">
          <div className="overview-main">
            <section className="overview-card overview-card--intro">
              <h2 className="overview-card__title">项目简介</h2>
              <div className="overview-intro">
                <p className="overview-intro__lead">
                  「今天开始和刘看山同居」是一款桌面端AI电子宠物——在AI重构连接的时代，把知乎优质内容、深度回答真正推到用户眼前。
                </p>
                <p className="overview-intro__p">
                  一代人有一代人的电子宠物。这一代人的，会跳江南Style，会陪你写代码，会告诉你：你还有一个重要的视角从未看见。
                </p>
                <p className="overview-intro__p">
                  作为桌面工作搭子，刘看山拥有长期记忆和20轮连续对话能力，像养宠物一样越养越懂你。
                </p>
                <p className="overview-intro__p">
                  它支持定时提醒——番茄钟专注倒计时、喝水提醒、久坐起身，把效率工具和健康管理搬到桌面；一键查询天气、即时播报知乎热榜，占领桌面信息入口的最小生态位。
                </p>
                <hr className="overview-intro__hr" />
                <p className="overview-intro__p">
                  算法推荐越推越窄，只看热闹不见干货；优质深度回答在碎片化娱乐化浪潮中，好内容找不到我，我也找不到好内容。这是新时代的痛点，它的核心价值在这里：用Agent智能打破信息茧房，重新连接知乎最优质的内容。刘看山会根据你的对话历史，从知乎海量内容中推送优质回答；更关键的是——它还能主动推荐与你观点最相左的优质回答，指出一个你从未接触过但对理解问题至关重要的知识领域，并附上高价值内容链接。
                </p>
                <p className="overview-intro__p overview-intro__p--closing">
                  我们的畅想是将知乎数亿条优质问答从被动等待搜索，变为主动嵌入用户桌面日常；用AI Agent的「反推荐」逻辑打破算法茧房，让被淹没的深度内容重见天日；以刘看山IP为锚点，构建用户与知乎之间的情感连接。
                </p>
              </div>
            </section>


            <section className="overview-card">
              <h2 className="overview-card__title">互动演示</h2>
              <p className="overview-card__text">点击下面的按钮，看看刘看山会做什么动作</p>
              <div className="overview-action-grid">
                <button
                  type="button"
                  className="overview-action-btn"
                  onClick={() => onPlayAction?.('run')}
                >
                  🏃 运动
                </button>
                <button
                  type="button"
                  className="overview-action-btn"
                  onClick={() => onPlayAction?.('happy')}
                >
                  💃 舞蹈
                </button>
                <button
                  type="button"
                  className="overview-action-btn"
                  onClick={() => onPlayAction?.('sleepy')}
                >
                  😴 犯困
                </button>
                <button
                  type="button"
                  className="overview-action-btn"
                  onClick={() => onPlayAction?.('hungry')}
                >
                  😋 饥饿
                </button>
              </div>
            </section>
          </div>

          <aside className="overview-sidebar">
            <section className="overview-card overview-card--support">
              <h2 className="overview-card__title">为看山助力 🌟</h2>
              <p className="overview-support__text">
                每一个点赞，都是跨越屏幕的“回响”。
              </p>
              <p className="overview-support__text">
                《今天开始和刘看山同居》的理想生活，离不开你的数字能量。恳请前往项目文章留下你的点赞与评论。你的每一次互动，都在为“看山玩宠计划”破圈加速，助力刘看山正式入驻知乎主站。
              </p>
              <p className="overview-support__text">
                让我们一起，把这份陪伴带给全网用户。
              </p>
              <button type="button" className="overview-btn overview-btn--blue overview-btn--block">
                💖 前往点赞支持
              </button>
            </section>

            <section className="overview-card overview-card--preview">
              <div className="overview-card__head">
                <h2 className="overview-card__title">桌宠预览</h2>
                <span className="overview-card__hint">实时</span>
              </div>
              <div className="overview-preview-slot">{children}</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
