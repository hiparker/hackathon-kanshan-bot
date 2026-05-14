import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { PetAction } from '@kanshan/bridge';
import newOverviewIslandBgUrl from '../pics/动森.png';
import carouselLuo0 from '../pics/luo0.png';
import carouselLuo1 from '../pics/luo1.jpeg';
import carouselLuo2 from '../pics/luo2.jpeg';
import carouselLuo3 from '../pics/luo3.jpeg';
import carouselLuo4 from '../pics/luo4.jpeg';
import carouselLuo5 from '../pics/luo5.png';
import demoSp1 from '../pics/sp1.mov';
import demoSp2 from '../pics/sp2.mov';
import demoSp3 from '../pics/sp3.mov';

const MAC_ARM_DOWNLOAD_URL = import.meta.env.VITE_KANSHAN_DOWNLOAD_MAC_ARM_URL || 'https://upload.bedebug.com/hackathon-2026/kanshan-darwin-aarch64.zip';
const MAC_INTEL_DOWNLOAD_URL = import.meta.env.VITE_KANSHAN_DOWNLOAD_MAC_INTEL_URL || 'https://github.com/hiparker/hackathon-kanshan-bot/releases/download/v1.0.10/_1.0.4_x64.dmg';
const WINDOWS_DOWNLOAD_URL = import.meta.env.VITE_KANSHAN_DOWNLOAD_WINDOWS_URL || 'https://upload.bedebug.com/hackathon-2026/kanshan-exe.zip';

const ZHIHU_PIN_URL = 'https://www.zhihu.com/pin/2037137126333096270';
const MAC_INSTALL_HELP_VIDEO_URL = 'https://www.zhihu.com/pin/2038237770338891383';

const PROJECT_TITLE = '今天开始和刘看山同居';
const PROJECT_INTRO = '桌面信息的最小生态位，打通知乎距离用户的最后一公里';

const LIKE_SUPPORT_HOVER = `为看山助力 🌟
每一个点赞，都是跨越屏幕的“回响”。

《今天开始和刘看山同居》的理想生活，离不开你的数字能量。恳请前往项目文章留下你的点赞与评论。你的每一次互动，都在为“看山玩宠计划”破圈加速，助力刘看山正式入驻知乎主站。

让我们一起，把这份陪伴带给全网用户。`;

const CAROUSEL_SLIDES: { src: string; alt: string }[] = [
  { src: carouselLuo0, alt: '展台画面 0' },
  { src: carouselLuo1, alt: '展台画面 1' },
  { src: carouselLuo2, alt: '展台画面 2' },
  { src: carouselLuo3, alt: '展台画面 3' },
  { src: carouselLuo4, alt: '展台画面 4' },
  { src: carouselLuo5, alt: '展台画面 5' },
];

const DEMO_VIDEOS: { title: string; src: string; caption: ReactNode }[] = [
  {
    title: '演示一',
    src: demoSp1,
    caption: "看山播报",
  },
  { title: '演示二', src: demoSp2, caption: '日常状态' },
  { title: '演示三', src: demoSp3, caption: '跳舞状态' },
];

export interface NewOverviewPageProps {
  shellClass: string;
  children: ReactNode;
  userName?: string | null;
  onPlayAction?: (action: PetAction) => void;
}

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

function IconVideoPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function IconVideoPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function DemoVideoTile({ title, src, caption }: { title: string; src: string; caption: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const pauseOthers = () => {
      document.querySelectorAll<HTMLVideoElement>('video.overview-dash__video-el').forEach((el) => {
        if (el !== video) el.pause();
      });
    };

    const onPlay = () => {
      pauseOthers();
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    setPlaying(!video.paused);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const onVideoClick = () => {
    toggle();
  };

  return (
    <article className="overview-card overview-dash__video-card">
      <div className={`overview-dash__video-frame${playing ? ' overview-dash__video-frame--playing' : ''}`}>
        <video
          ref={videoRef}
          className="overview-dash__video-el"
          playsInline
          preload="metadata"
          src={src}
          aria-label={title}
          onClick={onVideoClick}
        />
        <div className="overview-dash__video-controls">
          <button
            type="button"
            className="overview-dash__video-play"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            aria-pressed={playing}
            aria-label={playing ? `${title}，暂停` : `${title}，播放`}
          >
            {playing ? <IconVideoPause /> : <IconVideoPlay />}
          </button>
        </div>
      </div>
      <p className="overview-dash__video-caption">{caption}</p>
    </article>
  );
}

/** 新总览：侧栏（项目、下载、桌宠预览、互动）+ 主区轮播与演示视频 */
export function NewOverviewPage({ shellClass, children, userName, onPlayAction }: NewOverviewPageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState('Mac 版 (Apple Silicon)');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const carouselTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const restartCarouselAutoplayRef = useRef<() => void>(() => {});

  const options = [
    { label: 'Mac 版 (Apple Silicon)', ext: '.zip', url: MAC_ARM_DOWNLOAD_URL },
    { label: 'Mac 版 (Intel)', ext: '.dmg', url: MAC_INTEL_DOWNLOAD_URL },
    { label: 'Windows 版', ext: '.zip', url: WINDOWS_DOWNLOAD_URL },
  ];

  const greeting = userName?.trim() ? `Hi ${userName.trim()}！` : 'Hi，欢迎！';

  const openDownloadWithModal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setInstallModalOpen(true);
    setIsOpen(false);
  };

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

  useEffect(() => {
    const clearTimer = () => {
      if (carouselTimerRef.current !== null) {
        window.clearInterval(carouselTimerRef.current);
        carouselTimerRef.current = null;
      }
    };
    const startTimer = () => {
      clearTimer();
      if (CAROUSEL_SLIDES.length <= 1) return;
      carouselTimerRef.current = window.setInterval(() => {
        setCarouselIndex((i) => (i + 1) % CAROUSEL_SLIDES.length);
      }, 5200);
    };
    restartCarouselAutoplayRef.current = startTimer;
    startTimer();
    return clearTimer;
  }, []);

  const stepCarousel = (delta: number) => {
    setCarouselIndex((i) => (i + delta + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length);
    restartCarouselAutoplayRef.current();
  };

  useEffect(() => {
    if (!installModalOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [installModalOpen]);

  return (
    <main className={`${shellClass} glb-shell--overview glb-shell--new-overview`}>
      <div
        className="overview-awareness-bg overview-awareness-bg--island-photo"
        style={{ backgroundImage: `url(${newOverviewIslandBgUrl})` }}
        aria-hidden="true"
      />
      <div className="overview-page">
        <div className="overview-dash">
          <aside className="overview-dash__sidebar" aria-label="项目与渠道">
            <section className="overview-card overview-dash__card overview-dash__card--project">
              <h2 className="overview-dash__project-title">{PROJECT_TITLE}</h2>
              <p className="overview-dash__project-intro">{PROJECT_INTRO}</p>
            </section>

            <section className="overview-card overview-dash__card overview-dash__card--download">
              <div className="overview-dash__channels-head">
                <h2 className="overview-card__title overview-dash__channels-title">下载模块</h2>
                <p className="overview-dash__channels-sub">Mac 内部测试版 · 下载后按弹窗说明完成安装</p>
              </div>
              <button
                type="button"
                className="overview-download-primary overview-dash__download-wide"
                onClick={() => openDownloadWithModal(MAC_ARM_DOWNLOAD_URL)}
              >
                <IconDownload />
                <span className="overview-download-primary__label">下载 Mac Apple Silicon 版</span>
                <span className="overview-download-primary__meta">ZIP</span>
              </button>
              <div className="dropdown dropdown--secondary overview-dash__download-dropdown" ref={dropdownRef}>
                <button type="button" className="dropdown-btn overview-dash__download-dropdown-btn" onClick={() => setIsOpen(!isOpen)}>
                  <span>其他版本</span>
                  <IconChevronDown />
                </button>
                {isOpen ? (
                  <div className="dropdown-menu">
                    {options.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        className="dropdown-item"
                        onClick={() => {
                          setSelected(option.label);
                          openDownloadWithModal(option.url);
                        }}
                      >
                        <span className="dropdown-item-check">{selected === option.label ? <IconCheck /> : null}</span>
                        <span>{option.label}</span>
                        <span className="dropdown-item-ext">{option.ext}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <a
                href="https://github.com/hiparker/hackathon-kanshan-bot"
                target="_blank"
                rel="noopener noreferrer"
                className="overview-dash__download-gh"
              >
                <IconGithub />
                <span>在 GitHub 上查看</span>
              </a>
            </section>

            <section className="overview-card overview-dash__card overview-dash__card--preview">
              <h3 className="overview-dash__sidebar-preview-title">桌宠预览</h3>
              <p className="overview-dash__sidebar-preview-meta">下载后真实桌面效果，可在对话框提问</p>
              <div className="overview-preview-slot overview-dash__preview-slot overview-dash__preview-slot--sidebar">{children}</div>
            </section>

            <section className="overview-card overview-dash__card overview-dash__card--interaction" aria-label="互动演示">
              <h3 className="overview-dash__sidebar-interaction-title">互动演示</h3>
              <p className="overview-dash__sidebar-interaction-meta">点圆钮让看山做动作</p>
              <div className="overview-dash__sidebar-actions overview-dash__sidebar-actions--grid">
                <button type="button" className="overview-dash__device-btn" onClick={() => onPlayAction?.('run')} title="运动">
                  🏃
                </button>
                <button type="button" className="overview-dash__device-btn" onClick={() => onPlayAction?.('happy')} title="舞蹈">
                  💃
                </button>
                <button type="button" className="overview-dash__device-btn" onClick={() => onPlayAction?.('sleepy')} title="犯困">
                  😴
                </button>
                <button type="button" className="overview-dash__device-btn" onClick={() => onPlayAction?.('hungry')} title="饥饿">
                  😋
                </button>
              </div>
            </section>
          </aside>

          <div className="overview-dash__main">
            <header className="overview-dash__topbar">
              <div className="overview-dash__user">
                <p className="overview-dash__greeting">{greeting}</p>
                <p className="overview-dash__tagline">刘看山展台</p>
              </div>
              <div className="overview-dash__top-actions">
                <Link to="/cyberstyle" className="overview-btn overview-dash__cyber-home-link">
                  体验赛博风格
                </Link>
                <span className="overview-dash__like-wrap">
                  <a
                    href={ZHIHU_PIN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="overview-btn overview-btn--blue overview-dash__like"
                    style={{ textDecoration: 'none' }}
                  >
                    前往点赞支持
                  </a>
                  <span className="overview-dash__like-tip" role="tooltip">
                    {LIKE_SUPPORT_HOVER}
                  </span>
                </span>
              </div>
            </header>

            <section className="overview-dash__hero" aria-label="图片轮播">
              <div className="overview-dash__hero-visual overview-dash__hero-visual--carousel-only">
                <div className="overview-dash__hero-carousel" aria-hidden={false}>
                  {CAROUSEL_SLIDES.map((slide, i) => (
                    <img
                      key={`${slide.alt}-${i}`}
                      src={slide.src}
                      alt={slide.alt}
                      className={`overview-dash__hero-slide${i === carouselIndex ? ' is-active' : ''}`}
                      loading={i === 0 ? 'eager' : 'lazy'}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="overview-dash__carousel-nav overview-dash__carousel-nav--prev overview-dash__carousel-nav--minimal"
                  aria-label="上一张"
                  onClick={() => stepCarousel(-1)}
                >
                  <span aria-hidden="true">&lt;</span>
                </button>
                <button
                  type="button"
                  className="overview-dash__carousel-nav overview-dash__carousel-nav--next overview-dash__carousel-nav--minimal"
                  aria-label="下一张"
                  onClick={() => stepCarousel(1)}
                >
                  <span aria-hidden="true">&gt;</span>
                </button>
              </div>
            </section>

            <div className="overview-dash__videos-wrap">
              <h3 id="overview-dash-videos-heading" className="overview-dash__videos-heading">
                桌面实时画面展示视频
              </h3>
              <section className="overview-dash__videos" aria-labelledby="overview-dash-videos-heading">
                {DEMO_VIDEOS.map((item) => (
                  <DemoVideoTile key={item.title} title={item.title} src={item.src} caption={item.caption} />
                ))}
              </section>
            </div>
          </div>
        </div>

        {installModalOpen ? (
          <div
            className="overview-dash__install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-modal-title"
          >
            <div className="overview-dash__install-modal-card">
              <button
                type="button"
                className="overview-dash__install-modal-close"
                aria-label="关闭"
                onClick={() => setInstallModalOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
              <span className="overview-install__eyebrow">Mac 内部测试版</span>
              <h2 id="install-modal-title" className="overview-dash__install-modal-title">
                下载后按 3 步打开刘看山
              </h2>
              <p className="overview-dash__install-modal-lead">
                当前 ZIP 包未经过 Apple 签名和公证。macOS 可能提示应用已损坏。按下面步骤处理后即可测试。
              </p>
              <ol className="overview-install__steps overview-dash__install-modal-steps">
                <li>
                  <span className="overview-install__num">01</span>
                  <span>下载 ZIP 压缩包并解压。</span>
                </li>
                <li>
                  <span className="overview-install__num">02</span>
                  <span>
                    把 <strong>刘看山.app</strong> 拖入 <strong>应用程序</strong>。
                  </span>
                </li>
                <li>
                  <span className="overview-install__num">03</span>
                  <span>打开终端，执行下面命令。</span>
                </li>
              </ol>
              <code className="overview-install__command">xattr -d com.apple.quarantine /Applications/刘看山.app</code>
              <p className="overview-install__video-link">
                <a href={MAC_INSTALL_HELP_VIDEO_URL} target="_blank" rel="noopener noreferrer">
                  视频操作说明（知乎）
                </a>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
