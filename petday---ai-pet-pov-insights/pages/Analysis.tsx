
import React, { useEffect, useState, useRef } from 'react';
import { AnalysisData } from '../types';
import { apiUrl } from '../lib/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Share2, Play, Pause, Volume2, VolumeX,
  MapPin, Calendar, Clock, ChevronRight, ChevronLeft,
  Dog, Sun, Camera, List, AlertTriangle, ShieldAlert, Utensils, Droplet, Coffee,
  Heart, Swords, Users, Handshake, X, Info, Activity, Flame, Mountain,
  Copy, Check, Link, ChevronDown, Film
} from 'lucide-react';

interface AnalysisProps {
  onBack?: () => void;
}

const Analysis: React.FC<AnalysisProps> = ({ onBack }) => {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Video & TTS State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const moodChartRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [moodChartTop, setMoodChartTop] = useState(0);
  const [moodChartHeight, setMoodChartHeight] = useState(0);
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const sceneryScrollContainerRef = useRef<HTMLDivElement>(null);
  const [sceneryScrollLeft, setSceneryScrollLeft] = useState(0);
  const [showSocialInsights, setShowSocialInsights] = useState(false);
  const [showSceneryInsights, setShowSceneryInsights] = useState(false);
  const [showOriginalVideo, setShowOriginalVideo] = useState(false);
  const [pendingOriginalActivity, setPendingOriginalActivity] = useState<{ label: string; time: string } | null>(null);
  const [videoWarning, setVideoWarning] = useState<string | null>(null);
  const sceneryModalRef = useRef<HTMLDivElement>(null);
  const [sceneryModalWidth, setSceneryModalWidth] = useState(0);

  // Share & Download State
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [discoverySharing, setDiscoverySharing] = useState(false);
  const [discoveryShared, setDiscoveryShared] = useState(false);
  const [discoveryDescription, setDiscoveryDescription] = useState('');
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // Comments State (only for shared posts)
  const [isSharedToDiscovery, setIsSharedToDiscovery] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commenterName, setCommenterName] = useState('');

  // Measure Scenery Modal Width for accurate SVG drawing
  useEffect(() => {
    if (!showSceneryInsights || !sceneryModalRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSceneryModalWidth(entry.contentRect.width);
      }
    });

    observer.observe(sceneryModalRef.current);
    // Initial measure
    setSceneryModalWidth(sceneryModalRef.current.offsetWidth);

    return () => observer.disconnect();
  }, [showSceneryInsights, analysis]);

  // Close download menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    if (showDownloadMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDownloadMenu]);

  useEffect(() => {
    const sessionId = localStorage.getItem('currentSessionId');
    if (!sessionId) {
      setError('No session selected');
      setIsLoading(false);
      return;
    }

    const fetchAnalysis = async () => {
      try {
        const response = await fetch(apiUrl(`/api/session/${sessionId}`));
        const data = await response.json();
        if (data.status === 'ready') {
          setSessionData(data);
          setAnalysis(data.analysis);
          const hasHighlight = Boolean(data.highlightUrl);
          setShowOriginalVideo(!hasHighlight);
          setVideoWarning(hasHighlight ? null : (data.highlightError || 'AI highlight is unavailable for this session. Showing the original video.'));
        } else if (data.status === 'error') {
          setError(data.error || 'Analysis failed');
        } else {
          setError('Analysis is still processing');
        }
      } catch (err) {
        setError('Failed to fetch analysis data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalysis();
  }, []);

  // Check if session is shared to Discovery and fetch comments
  useEffect(() => {
    if (!sessionData?.id) return;

    const checkSharedAndFetchComments = async () => {
      try {
        // Check if shared
        const checkRes = await fetch(apiUrl(`/api/discovery/check/${sessionData.id}`));
        const checkData = await checkRes.json();
        setIsSharedToDiscovery(checkData.isShared);

        // If shared, fetch comments
        if (checkData.isShared) {
          const commentsRes = await fetch(apiUrl(`/api/comments/${sessionData.id}`));
          if (commentsRes.ok) {
            const commentsData = await commentsRes.json();
            setComments(commentsData);
          }
        }
      } catch (err) {
        console.error('Failed to check discovery status:', err);
      }
    };

    checkSharedAndFetchComments();
  }, [sessionData?.id]);

  // Robust width detection for SVG connections
  useEffect(() => {
    if (!chartWrapperRef.current || isLoading) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        if (moodChartRef.current) {
          setMoodChartTop(moodChartRef.current.offsetTop);
          setMoodChartHeight(moodChartRef.current.offsetHeight);
        }
      }
    });

    observer.observe(chartWrapperRef.current);
    // Initial measure
    setContainerWidth(chartWrapperRef.current.offsetWidth);
    if (moodChartRef.current) {
      setMoodChartTop(moodChartRef.current.offsetTop);
      setMoodChartHeight(moodChartRef.current.offsetHeight);
    }

    return () => observer.disconnect();
  }, [isLoading, analysis]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  const handleSceneryScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setSceneryScrollLeft(e.currentTarget.scrollLeft);
  };

  // Video Controls
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
      updateSubtitles(time);
    }
  };

  const syncVideoToChart = (timeStr: string, originalTimeStr?: string) => {
    const effectiveTime = showOriginalVideo && originalTimeStr ? originalTimeStr : timeStr;
    const [m, s] = effectiveTime.split(':').map(Number);
    const targetSeconds = m * 60 + s;
    if (videoRef.current) {
      videoRef.current.currentTime = targetSeconds;
      setCurrentTime(targetSeconds);
      if (!showOriginalVideo) updateSubtitles(targetSeconds);
      if (!isPlaying) togglePlay();
    }
  };

  const handleActivityTimelineClick = (event: { time: string; originalTime?: string; label: string }) => {
    const activityOriginalTime = event.originalTime || event.time;
    if (!activityOriginalTime) return;

    if (showOriginalVideo) {
      syncVideoToChart(activityOriginalTime, activityOriginalTime);
      return;
    }

    const activitySeconds = timeToSeconds(activityOriginalTime);
    const mappedHighlightActivity = (analysis?.timelineHighlight || []).find((item) => {
      const sourceTime = item.originalTime || item.time;
      return sourceTime ? timeToSeconds(sourceTime) === activitySeconds : false;
    });

    if (mappedHighlightActivity?.time) {
      syncVideoToChart(mappedHighlightActivity.time, mappedHighlightActivity.originalTime || activityOriginalTime);
      return;
    }

    setPendingOriginalActivity({
      label: event.label || 'Selected activity',
      time: activityOriginalTime
    });
  };

  const handleSwitchToOriginalForActivity = () => {
    if (!pendingOriginalActivity) return;
    const targetTime = pendingOriginalActivity.time;
    setPendingOriginalActivity(null);
    setShowOriginalVideo(true);
    window.setTimeout(() => {
      syncVideoToChart(targetTime, targetTime);
    }, 120);
  };

  const updateSubtitles = (time: number) => {
    if (analysis?.narrativeSegments) {
      // Build a clean, time-sorted subtitle list for stable cue switching.
      const relevantSegments = (showOriginalVideo
        ? analysis.narrativeSegments
        : analysis.narrativeSegments.filter((seg: any) => seg.inHighlight))
        .map((seg: any) => {
          const timeStr = showOriginalVideo ? (seg.originalTime || seg.timestamp) : seg.timestamp;
          if (!timeStr) return null;
          const [m, s] = timeStr.split(':').map(Number);
          if (Number.isNaN(m) || Number.isNaN(s)) return null;
          return {
            ...seg,
            _sec: m * 60 + s
          };
        })
        .filter((seg: any) => seg !== null)
        .sort((a: any, b: any) => a._sec - b._sec);

      let activeSubtitle = "";
      let activeIndex = -1;
      for (let i = 0; i < relevantSegments.length; i++) {
        if (relevantSegments[i]._sec <= time) activeIndex = i;
        else break;
      }

      if (activeIndex >= 0) {
        const current = relevantSegments[activeIndex];
        const next = relevantSegments[activeIndex + 1];
        // Prevent stale subtitle from sticking when cue points are sparse.
        const maxHoldSec = showOriginalVideo ? 8 : 6;
        const cueEnd = Math.min(next ? next._sec : Infinity, current._sec + maxHoldSec);
        if (time < cueEnd) {
          activeSubtitle = current.text || "";
        }
      }

      // Highlight mode fallback: when narrative cues are sparse, use activity labels briefly.
      if (!activeSubtitle && !showOriginalVideo && subtitleFallbackTimeline.length > 0) {
        let fallback: any = null;
        for (let i = 0; i < subtitleFallbackTimeline.length; i++) {
          const item = subtitleFallbackTimeline[i];
          const ts = item.time || item.originalTime;
          if (!ts) continue;
          const sec = timeToSeconds(ts);
          if (sec <= time) fallback = { label: item.label, sec };
          else break;
        }

        if (fallback && time < fallback.sec + 4) {
          activeSubtitle = fallback.label;
        }
      }

      setCurrentSubtitle(activeSubtitle);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      updateSubtitles(time);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // TTS Logic
  const speakNarrative = () => {
    if (!analysis?.aiNote) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(analysis.aiNote);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (isPlaying && !isMuted) {
      // speakNarrative();
    } else {
      window.speechSynthesis.cancel();
    }
  }, [isPlaying, isMuted]);

  // Refresh subtitles when video mode changes
  useEffect(() => {
    if (videoRef.current) {
      updateSubtitles(videoRef.current.currentTime);
    }
  }, [showOriginalVideo]);

  useEffect(() => {
    if (showOriginalVideo && pendingOriginalActivity) {
      setPendingOriginalActivity(null);
    }
  }, [showOriginalVideo, pendingOriginalActivity]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0F1115]">
        <div className="flex flex-col items-center gap-6">
          <div className="size-20 border-4 border-[#F2CC0D] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xl font-bold text-[#F2CC0D] animate-pulse uppercase tracking-[0.3em]">AI Analyzing...</p>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0F1115]">
        <div className="bg-red-500/10 border border-red-500/20 p-12 rounded-[3rem] text-center max-w-lg">
          <div className="size-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-red-500 text-4xl">error</span>
          </div>
          <h2 className="text-3xl font-black text-white mb-4">Analysis Interrupted</h2>
          <p className="text-slate-400 mb-8 text-lg">{error || 'Could not load analysis session'}</p>
          <button onClick={() => window.location.reload()} className="w-full bg-[#F2CC0D] text-black py-4 rounded-2xl font-black hover:scale-105 transition-all">RETRY ANALYSIS</button>
        </div>
      </div>
    );
  }

  const timeToSeconds = (timeStr: string) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  const originalDuration = sessionData?.originalDuration || 0;
  const hasHighlightVideo = Boolean(sessionData?.highlightUrl);
  const currentVideoSrc = (!showOriginalVideo && hasHighlightVideo)
    ? sessionData?.highlightUrl
    : sessionData?.videoUrl;

  const getRelationshipConfig = (status?: string) => {
    switch (status) {
      case 'Bestie': return { color: 'text-green-400', bg: 'bg-green-500/10', icon: <Heart size={12} className="fill-current" /> };
      case 'Soulmate': return { color: 'text-pink-400', bg: 'bg-pink-500/10', icon: <Flame size={12} /> };
      case 'Rival': return { color: 'text-red-400', bg: 'bg-red-500/10', icon: <Swords size={12} /> };
      default: return { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: <Users size={12} /> };
    }
  };

  // Share & Download Helpers
  const getShareUrl = () => {
    const sessionId = localStorage.getItem('currentSessionId');
    return `${window.location.origin}?session=${sessionId}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: analysis.title,
          text: `Check out ${sessionData?.petName || 'my pet'}'s adventure: ${analysis.title}`,
          url: getShareUrl()
        });
        setShowShareModal(false);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }
  };

  const handleSocialShare = (platform: 'twitter' | 'facebook' | 'whatsapp') => {
    const url = encodeURIComponent(getShareUrl());
    const text = encodeURIComponent(`Check out ${sessionData?.petName || 'my pet'}'s adventure: ${analysis.title}`);

    const shareUrls = {
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      whatsapp: `https://wa.me/?text=${text}%20${url}`
    };

    window.open(shareUrls[platform], '_blank', 'width=600,height=400');
    setShowShareModal(false);
  };

  const handleShareToDiscovery = async () => {
    if (!sessionData || discoverySharing) return;

    setDiscoverySharing(true);
    try {
      const response = await fetch(apiUrl('/api/discovery'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionData.id,
          description: discoveryDescription || `${sessionData.petName}'s adventure: ${analysis.title}`
        })
      });

      if (response.ok) {
        setDiscoveryShared(true);
        setIsSharedToDiscovery(true); // Enable comments section
        setTimeout(() => {
          setShowShareModal(false);
          setDiscoveryShared(false);
          setDiscoveryDescription('');
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to share to Discovery:', err);
    } finally {
      setDiscoverySharing(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!sessionData || !newComment.trim() || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
      const response = await fetch(apiUrl(`/api/comments/${sessionData.id}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: commenterName || 'Anonymous',
          content: newComment.trim()
        })
      });

      if (response.ok) {
        const data = await response.json();
        setComments(prev => [data.comment, ...prev]);
        setNewComment('');
      }
    } catch (err) {
      console.error('Failed to submit comment:', err);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDownload = async (type: 'highlight' | 'original' | 'cover') => {
    let url: string | undefined;
    let filename: string;

    switch (type) {
      case 'highlight':
        url = sessionData?.highlightUrl;
        filename = `${sessionData?.petName || 'pet'}-highlight.mp4`;
        break;
      case 'original':
        url = sessionData?.videoUrl;
        filename = `${sessionData?.petName || 'pet'}-original.mp4`;
        break;
      case 'cover':
        url = sessionData?.coverUrl;
        filename = `${sessionData?.petName || 'pet'}-cover.jpg`;
        break;
    }

    if (!url) return;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      // Fallback: open in new tab
      window.open(url, '_blank');
    }

    setShowDownloadMenu(false);
  };

  const fullTimeline = (analysis?.timeline && analysis.timeline.length > 0)
    ? analysis.timeline
    : (analysis?.timelineHighlight || []);

  const subtitleFallbackTimeline = showOriginalVideo
    ? fullTimeline
    : ((analysis?.timelineHighlight && analysis.timelineHighlight.length > 0)
      ? analysis.timelineHighlight
      : fullTimeline);

  const fullMoodData = (analysis?.moodData && analysis.moodData.length > 0)
    ? analysis.moodData
    : (analysis?.moodDataHighlight || []);

  const chartData = fullMoodData.map(d => ({
    ...d,
    originalTime: d.originalTime || d.name,
    originalSeconds: timeToSeconds(d.originalTime || d.name)
  })) || []; // Keep order as provided by AI to maintain the story sequence

  // 1. Process Scenery Focus Data for Graph
  // We create a "Density" curve where the Y-axis is the stayDuration
  const sceneryFocusData = analysis?.scenery?.map(s => ({
    ...s,
    // Use saved originalTime if available (Server Fix), else fallback to timestamp
    originalSeconds: timeToSeconds(s.originalTime || s.timestamp),
    // ROBUST PARSING: Extract first numeric value from string (e.g. "approx 12s" -> 12)
    value: (() => {
      if (typeof s.stayDuration === 'number') return s.stayDuration;
      if (typeof s.stayDuration === 'string') {
        const match = s.stayDuration.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[0]) : 0;
      }
      return 0;
    })()
  })).sort((a, b) => a.originalSeconds - b.originalSeconds) || [];

  // Helper to find the index of the closest chart point for a given timestamp
  const findClosestIndex = (timeStr: string) => {
    const target = timeToSeconds(timeStr);
    let closestIdx = 0;
    let minDiff = Infinity;
    chartData.forEach((point, idx) => {
      const diff = Math.abs(point.originalSeconds - target);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    return closestIdx;
  };

  return (
    <div className="p-4 md:p-8 lg:p-12 max-w-[1600px] mx-auto min-h-screen pb-32">

      {/* HEADER SECTION */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <span className="px-3 py-1 bg-[#F2CC0D]/10 text-[#F2CC0D] text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-[#F2CC0D]/20">AI Generated Report</span>
            <span className="text-slate-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <Calendar size={12} /> {sessionData?.createdAt ? new Date(sessionData.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Jan 21, 2026'}
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-black tracking-tight leading-none"
          >
            {analysis.title}
          </motion.h1>
          <div className="flex items-center gap-4">
            {/* Share Button */}
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-3 bg-white/5 border border-white/10 px-6 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-white/10 transition-all text-white/60 hover:text-white"
            >
              <Share2 size={18} /> Share
            </button>

            {/* Download Button with Dropdown */}
            <div className="relative" ref={downloadMenuRef}>
              <button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                className="flex items-center gap-3 bg-[#F2CC0D] text-black px-6 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all shadow-xl shadow-[#F2CC0D]/20"
              >
                <Download size={18} /> Download <ChevronDown size={14} className={`transition-transform ${showDownloadMenu ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showDownloadMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    className="absolute right-0 top-full mt-2 bg-[#1a1d23] border border-white/10 rounded-2xl overflow-hidden shadow-2xl min-w-[220px] z-50"
                  >
                    <button
                      onClick={() => handleDownload('highlight')}
                      className="flex items-center gap-3 w-full px-5 py-4 text-left text-sm font-semibold text-white hover:bg-white/5 transition-colors"
                    >
                      <Film size={18} className="text-[#F2CC0D]" />
                      <div>
                        <div>AI Highlight</div>
                        <div className="text-xs text-white/40 font-normal">Edited video</div>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

        {/* LEFT COLUMN (Player & Sync Chart) */}
        <div className="lg:col-span-8 space-y-10">

          {/* Video Source Toggle - above video, aligned with Share button */}
          <div className="flex justify-end -mt-[6.25rem] -mb-4">
            <div className="flex items-center bg-surface-dark rounded-2xl border border-white/10 p-1.5">
              <button
                onClick={() => {
                  if (!hasHighlightVideo) {
                    setVideoWarning(sessionData?.highlightError || 'AI highlight is unavailable for this session. Showing the original video.');
                    return;
                  }
                  if (showOriginalVideo) {
                    const wasPlaying = !videoRef.current?.paused;
                    setVideoWarning(null);
                    setShowOriginalVideo(false);
                    setTimeout(() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        if (wasPlaying) videoRef.current.play();
                      }
                    }, 100);
                  }
                }}
                className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  !showOriginalVideo && hasHighlightVideo
                    ? 'bg-[#F2CC0D] text-black'
                    : hasHighlightVideo
                      ? 'text-white/50 hover:text-white'
                      : 'text-white/30 cursor-not-allowed'
                }`}
              >
                AI Highlight
              </button>
              <button
                onClick={() => {
                  if (!showOriginalVideo) {
                    const wasPlaying = !videoRef.current?.paused;
                    setVideoWarning(null);
                    setShowOriginalVideo(true);
                    setTimeout(() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        if (wasPlaying) videoRef.current.play();
                      }
                    }, 100);
                  }
                }}
                className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  showOriginalVideo
                    ? 'bg-[#F2CC0D] text-black'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Original
              </button>
            </div>
          </div>

          {/* PREMIUM VIDEO PLAYER */}
          <section className="relative aspect-video bg-black rounded-[3rem] overflow-hidden border border-white/5 shadow-2xl group ring-1 ring-white/10">
            <video
              ref={videoRef}
              src={currentVideoSrc}
              className="w-full h-full object-cover"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onClick={togglePlay}
              onError={() => {
                if (!showOriginalVideo) {
                  setVideoWarning(sessionData?.highlightError || 'AI highlight failed to load. Switched to original video.');
                  setShowOriginalVideo(true);
                } else {
                  setVideoWarning('Original video failed to load. Please refresh and try again.');
                }
              }}
              poster={sessionData?.videoUrl}
            />

            {videoWarning && (
              <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 bg-black/70 border border-[#F2CC0D]/40 text-[#F2CC0D] text-[11px] font-bold tracking-wide px-4 py-2 rounded-full backdrop-blur-md">
                {videoWarning}
              </div>
            )}

            <AnimatePresence>
              {!isPlaying && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  onClick={togglePlay}
                  className="absolute inset-0 m-auto z-20 bg-[#F2CC0D] text-black size-28 rounded-full flex items-center justify-center hover:scale-110 transition-all shadow-2xl shadow-[#F2CC0D]/40"
                >
                  <Play size={48} fill="currentColor" strokeWidth={3} />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Subtitles Overlay */}
            {showSubtitles && currentSubtitle && (
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-3/4 text-center z-10">
                <p className="bg-black/60 backdrop-blur-md text-white text-lg font-bold px-6 py-3 rounded-2xl border border-white/10 shadow-2xl inline-block">
                  {currentSubtitle}
                </p>
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

            {/* Integrated Controls */}
            <div className="absolute bottom-8 left-8 right-8 opacity-0 group-hover:opacity-100 transition-all transform translate-y-4 group-hover:translate-y-0 z-20">
              <div className="bg-black/40 backdrop-blur-2xl rounded-[2rem] border border-white/10 p-4 space-y-4">
                <input
                  type="range" min="0" max={duration || 0} step="0.1" value={currentTime} onChange={handleSeek}
                  className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#F2CC0D] hover:accent-[#F2CC0D]/80"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button onClick={togglePlay} className="text-[#F2CC0D] hover:scale-110 transition-all">
                      {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                    </button>
                    <button onClick={() => setIsMuted(!isMuted)} className="text-white/60 hover:text-white transition-all">
                      {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                    </button>
                    <span className="text-xs font-black text-white/40 tracking-widest uppercase tabular-nums">
                      {formatTime(currentTime)} <span className="mx-2 text-white/10">/</span> {formatTime(duration)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setShowSubtitles(!showSubtitles)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${showSubtitles ? 'bg-[#F2CC0D] text-black border-[#F2CC0D]' : 'bg-white/5 text-white/40 border-white/10'}`}
                    >
                      Captions
                    </button>
                    <button onClick={speakNarrative} className="bg-white/10 p-2 rounded-xl text-white/60 hover:text-white">
                      <Volume2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* INTEGRATED MOOD & EVENT TIMELINE */}
          <section className="bg-surface-dark rounded-[3rem] border border-white/5 p-10 shadow-2xl space-y-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Clock size={120} />
            </div>

            <header className="flex items-center justify-between pointer-events-none">
              <div className="space-y-1">
                <h2 className="text-2xl font-black tracking-tight text-white uppercase">Activity & Mood Sync</h2>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Correlating pet behavior with emotional peaks</p>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F2CC0D]/10 rounded-full border border-[#F2CC0D]/20">
                  <span className="size-2 rounded-full bg-[#F2CC0D] animate-pulse"></span>
                  <span className="text-[10px] font-black text-[#F2CC0D] uppercase tracking-widest">Excitement Index</span>
                </div>
              </div>
            </header>

            {/* TIMELINE & CHART SYNC AREA */}
            <div className="relative pt-10" ref={chartWrapperRef}>

              {/* SVG Connector Overlay - Dynamic Connections */}
              <svg
                className="absolute inset-x-0 w-full pointer-events-none z-30"
                style={{
                  top: '150px',
                  height: Math.max(180, (moodChartTop + moodChartHeight) - 150)
                }}
              >
                {(() => {
                  if (!chartData.length) return null;
                  const maxChartSeconds = Math.max(
                    originalDuration || 0,
                    ...chartData.map(d => d.originalSeconds ?? timeToSeconds(d.originalTime || d.name)),
                    1
                  );

                  return fullTimeline.map((event, idx) => {
                    // 1. Calculate Chart Landing Point (Time-accurate)
                    const eventSeconds = timeToSeconds(event.originalTime || event.time);
                    const pointIndex = findClosestIndex(event.originalTime || event.time);

                    const chartMarginRight = 30; // Matches AreaChart margin.right
                    const yAxisWidth = 30; // Matches YAxis width
                    const plotWidth = containerWidth - chartMarginRight - yAxisWidth;
                    const xChart = yAxisWidth + (eventSeconds / maxChartSeconds) * plotWidth;

                    // 1.5 Calculate Chart Y Position based on actual curve value
                    const chartValue = chartData[pointIndex]?.value ?? 0;
                    const chartMarginTop = 80;
                    const chartMarginBottom = 0;
                    const xAxisHeight = 30;
                    const chartHeight = moodChartHeight || 350;
                    const drawingHeight = chartHeight - chartMarginTop - chartMarginBottom - xAxisHeight;
                    const zeroYPixels = moodChartTop + chartMarginTop + drawingHeight;
                    const endY = zeroYPixels - (chartValue / 100) * drawingHeight - 150;

                    // 2. Calculate Card Source Point (Dynamic X based on scroll)
                    const cardWidth = 256;
                    const gap = 16;
                    const paddingLeft = 40; // px-10 in the card container
                    const cardXCenter = idx * (cardWidth + gap) + (cardWidth / 2) - scrollLeft + paddingLeft;

                    // Visibility check: Show line if card center is within the visible chart area
                    // Extended bounds slightly to avoid flickering at edges
                    if (cardXCenter < -50 || cardXCenter > containerWidth + 50) return null;

                    return (
                      <motion.path
                        key={idx}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        d={`M ${cardXCenter} 0 
                            L ${cardXCenter} 30 
                            C ${cardXCenter} 50, ${xChart} 50, ${xChart} 80 
                            L ${xChart} ${endY}`}
                        stroke="#F2CC0D"
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        fill="none"
                        strokeOpacity={Math.max(0.1, 1 - Math.abs(cardXCenter - xChart) / 1000)}
                        transition={{ duration: 0.3 }}
                      />
                    );
                  });
                })()}
              </svg>

              {/* HORIZONTAL SCROLLABLE TIMELINE CARDS */}
              <div className="relative group/timeline z-20">
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  className="flex gap-4 overflow-x-auto pb-10 scrollbar-hide snap-x no-scrollbar px-10"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {fullTimeline.map((event, idx) => (
                    <motion.button
                      key={idx}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => handleActivityTimelineClick(event)}
                      className="flex-shrink-0 w-64 p-6 bg-white/5 border border-white/10 rounded-3xl text-left snap-start group hover:border-[#F2CC0D]/30 transition-all shadow-xl backdrop-blur-sm"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[#F2CC0D] font-black text-xs tracking-tighter tabular-nums px-2 py-1 bg-[#F2CC0D]/10 rounded-lg">{event.originalTime || event.time}</span>
                        <span className="material-symbols-outlined text-white/20 group-hover:text-[#F2CC0D] transition-colors !text-xl overflow-hidden max-w-[24px]">{event.icon || 'timeline'}</span>
                      </div>
                      <p className="font-bold text-sm text-white/80 group-hover:text-white transition-colors uppercase tracking-tight line-clamp-2 leading-relaxed">
                        {event.label}
                      </p>
                    </motion.button>
                  ))}
                </div>

                {/* Navigation Arrows for Scroll */}
                <button
                  onClick={() => scrollContainerRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                  className="absolute left-[10px] top-[128px] -translate-y-1/2 size-10 bg-[#F2CC0D] text-black rounded-full flex items-center justify-center shadow-2xl opacity-0 group-hover/timeline:opacity-100 transition-opacity z-10"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  onClick={() => scrollContainerRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                  className="absolute right-[10px] top-[128px] -translate-y-1/2 size-10 bg-[#F2CC0D] text-black rounded-full flex items-center justify-center shadow-2xl opacity-0 group-hover/timeline:opacity-100 transition-opacity z-10"
                >
                  <ChevronRight size={24} />
                </button>
              </div>

              <div ref={moodChartRef} className="h-[350px] w-full mt-10">
                <ResponsiveContainer width="100%" height="100%">
                  {(() => {
                    const maxChartSeconds = Math.max(
                      originalDuration || 0,
                      ...chartData.map(d => d.originalSeconds ?? timeToSeconds(d.originalTime || d.name)),
                      1
                    );
                    return (
                      <AreaChart data={chartData} margin={{ top: 80, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F2CC0D" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F2CC0D" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="originalSeconds"
                      type="number"
                      domain={[0, maxChartSeconds]}
                      stroke="rgba(255,255,255,0.2)"
                      fontSize={10}
                      fontWeight="bold"
                      axisLine={false}
                      tickLine={false}
                      tick={{ dy: 10 }}
                      interval="preserveStartEnd"
                      padding={{ left: 0, right: 0 }}
                      tickFormatter={(val) => formatTime(val as number)}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={false}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                      label={{
                        value: 'Mood Index',
                        angle: -90,
                        position: 'insideLeft',
                        fill: 'rgba(255,255,255,0.35)',
                        fontSize: 10,
                        fontWeight: 700,
                        offset: -5
                      }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1A1D23', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}
                      itemStyle={{ color: '#F2CC0D', fontWeight: 'bold' }}
                      labelStyle={{ color: 'white', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 900 }}
                      labelFormatter={(val) => `Time: ${formatTime(val as number)}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#F2CC0D"
                      strokeWidth={4}
                      fillOpacity={1}
                      fill="url(#colorValue)"
                      animationDuration={2000}
                    />
                    {/* Correlation Line Markers on Chart - Muted and smaller to prioritize SVG connections */}
                    {fullTimeline.map((event, idx) => (
                      <ReferenceLine
                        key={idx}
                        x={timeToSeconds(event.originalTime || event.time)}
                        stroke="#F2CC0D"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                        strokeOpacity={0.2}
                      />
                    ))}
                  </AreaChart>
                    );
                  })()}
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* SCENERY INTELLIGENCE (Moved from Right Column) */}
          <section className="bg-surface-dark rounded-[3rem] border border-white/5 p-10 shadow-2xl">
            <header className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center text-white/20">
                  <Mountain size={20} />
                </div>
                <h2 className="text-xl font-black uppercase tracking-tight">Favorite Views</h2>
              </div>
              <button
                onClick={() => setShowSceneryInsights(true)}
                className="px-4 py-2 bg-blue-500/10 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all"
              >
                Deep Analytics
              </button>
            </header>

            <div className="grid grid-cols-2 gap-4">
              {analysis?.scenery?.map?.((item, idx) => (
                <motion.div
                  key={idx}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => item.timestamp && syncVideoToChart(item.timestamp, item.originalTime)}
                  className="group relative aspect-[4/3] rounded-2xl overflow-hidden border border-white/10 cursor-pointer"
                >
                  {item.url ? (
                    <img src={item.url} alt={item.description} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-900 flex items-center justify-center p-4 text-center">
                      <span className="text-[10px] text-white/40 font-bold leading-tight uppercase">{item.sceneryLabel || item.description}</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                    <p className="text-[9px] font-black text-white/90 leading-tight uppercase truncate">{item.sceneryLabel || item.description || 'Scenery'}</p>
                    <span className="text-[8px] font-black text-blue-400/80 uppercase mt-0.5 block tracking-widest">{item.timestamp}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (Pet Narrative & Visual Evidence) */}
        <aside className="lg:col-span-4 space-y-10 lg:-mt-6">

          {/* AI NARRATIVE CARD */}
          <section className="bg-gradient-to-br from-[#F2CC0D] to-[#E5C10C] rounded-[3rem] p-10 text-black shadow-2xl relative overflow-hidden group">
            <div className="absolute top-[-20px] right-[-20px] opacity-10 transform -rotate-12 group-hover:rotate-0 transition-transform duration-700">
              <Dog size={200} />
            </div>
            <div className="relative z-10 space-y-6 text-xl">
              <div className="flex items-center gap-4 mb-8">
                <div className="size-12 bg-black rounded-2xl flex items-center justify-center">
                  <Dog className="text-[#F2CC0D]" size={28} />
                </div>
                <div>
                  <h3 className="font-black uppercase tracking-widest text-sm">Pet Perspective</h3>
                  <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mt-0.5">Narrative Insight</p>
                </div>
              </div>
              <p className="font-black leading-[1.4] italic text-2xl tracking-tight">
                "{analysis.aiNote}"
              </p>
              <div className="pt-8 border-t border-black/10 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Verified AI Intuition</span>
                <button onClick={speakNarrative} className="bg-black text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">Listen to POV</button>
              </div>
            </div>
          </section>

          {/* FRIENDS ENCOUNTERED (Simplified List) */}
          <section className="bg-surface-dark rounded-[3rem] border border-white/5 p-10 shadow-2xl">
            <header className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center text-white/20">
                  <Dog size={20} />
                </div>
                <h2 className="text-xl font-black uppercase tracking-tight">Friends</h2>
              </div>
              <button
                onClick={() => setShowSocialInsights(true)}
                className="px-4 py-2 bg-[#F2CC0D]/10 text-[#F2CC0D] text-[10px] font-black uppercase tracking-widest rounded-xl border border-[#F2CC0D]/20 hover:bg-[#F2CC0D] hover:text-black transition-all"
              >
                Social Deep Dive
              </button>
            </header>

            <div className="grid grid-cols-2 gap-4">
              {analysis?.friends?.map?.((friend, idx) => {
                // Get all interaction timestamps (use timestamps array if available, otherwise fall back to single timestamp)
                const interactions = friend.timestamps?.length > 0
                  ? friend.timestamps
                  : friend.timestamp ? [{ time: friend.timestamp, duration: friend.duration }] : [];
                const hasMultipleInteractions = interactions.length > 1;

                return (
                  <motion.div
                    key={idx}
                    whileHover={{ scale: 1.02 }}
                    className="group relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-[#F2CC0D]/30 transition-all flex flex-col items-center justify-center p-4 text-center"
                  >
                    <div
                      onClick={() => {
                        if (showOriginalVideo) {
                          if (friend.originalTimestamp) syncVideoToChart(friend.originalTimestamp, friend.originalTimestamp);
                        } else if (friend.timestamp) {
                          syncVideoToChart(friend.timestamp, friend.originalTimestamp);
                        } else if (friend.originalTimestamp) {
                          setPendingOriginalActivity({ label: `${friend.name}'s appearance`, time: friend.originalTimestamp });
                        }
                      }}
                      className="cursor-pointer flex flex-col items-center"
                    >
                      <div className="size-20 rounded-full overflow-hidden bg-slate-900 border-2 border-white/10 mb-2 shadow-lg group-hover:scale-110 transition-transform duration-500">
                        {friend.url ? (
                          <img src={friend.url} alt={friend.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Dog size={32} className="text-white/10" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="font-black text-sm truncate max-w-full px-2">{friend.name}</h4>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{friend.type}</span>
                      </div>
                    </div>

                    {/* Interaction buttons - show when there are multiple interactions */}
                    {hasMultipleInteractions && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-center">
                        {interactions.map((interaction, i) => {
                          const inHighlight = !!interaction.time;
                          return (
                            <button
                              key={i}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (showOriginalVideo) {
                                  if (interaction.originalTime) syncVideoToChart(interaction.originalTime, interaction.originalTime);
                                } else if (inHighlight) {
                                  syncVideoToChart(interaction.time, interaction.originalTime);
                                } else if (interaction.originalTime) {
                                  setPendingOriginalActivity({ label: `${friend.name} interaction ${i + 1}`, time: interaction.originalTime });
                                }
                              }}
                              className={`size-6 text-[10px] font-black rounded-lg border transition-all flex-shrink-0 ${
                                !showOriginalVideo && !inHighlight
                                  ? 'bg-white/5 text-white/30 border-white/10'
                                  : 'bg-[#F2CC0D]/20 hover:bg-[#F2CC0D] text-[#F2CC0D] hover:text-black border-[#F2CC0D]/30'
                              }`}
                              title={inHighlight || showOriginalVideo
                                ? `Interaction ${i + 1} at ${showOriginalVideo ? interaction.originalTime : interaction.time}`
                                : `Interaction ${i + 1} — not in highlight`}
                            >
                              {i + 1}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="absolute top-2 right-2">
                      <span className="text-[10px] bg-black/60 backdrop-blur-md text-white/60 px-2 py-0.5 rounded-lg font-black tabular-nums border border-white/5">
                        {hasMultipleInteractions ? `${interactions.length}x` : ((showOriginalVideo ? friend.originalTimestamp : friend.timestamp) || '0:00')}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* DIETARY HABITS CARD (Renamed & Reordered) */}
          {analysis?.dietaryHabits && analysis.dietaryHabits.length > 0 && (
            <section className="bg-white/5 backdrop-blur-3xl rounded-[3rem] border border-white/5 p-10 shadow-2xl relative overflow-hidden group">
              <header className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center text-white/20">
                    <Utensils size={20} />
                  </div>
                  <h2 className="text-xl font-black uppercase tracking-tight">Food</h2>
                </div>
              </header>
              <div className="grid grid-cols-2 gap-4">
                {analysis.dietaryHabits.map((habit, idx) => (
                  <motion.div
                    key={idx}
                    whileHover={{ y: -5 }}
                    onClick={() => syncVideoToChart(habit.timestamp)}
                    className="group relative h-40 bg-white/5 border border-white/10 rounded-[2rem] cursor-pointer hover:border-[#F2CC0D]/30 transition-all overflow-hidden"
                  >
                    {/* Background Image if available */}
                    {habit.url ? (
                      <div className="absolute inset-0">
                        <img src={habit.url} alt={habit.item} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-10">
                        {habit.action === 'drinking' ? <Droplet size={64} /> : <Utensils size={64} />}
                      </div>
                    )}

                    <div className="absolute inset-0 p-5 flex flex-col justify-end">
                      <div>
                        <h4 className="font-black text-sm uppercase tracking-tight text-white/90 leading-tight">{habit.item}</h4>
                        <span className="text-[9px] bg-white/10 backdrop-blur-md text-white/60 px-2 py-0.5 rounded font-black tabular-nums mt-1 inline-block">{habit.timestamp}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* SAFETY & RISK ALERTS (Moved to Bottom) */}
          {analysis?.safetyAlerts && analysis.safetyAlerts.length > 0 && (
            <section className="space-y-4">
              <header className="flex items-center gap-2 mb-4 px-2">
                <ShieldAlert className="text-red-500" size={20} />
                <h2 className="text-xl font-black uppercase tracking-tight">Safety Alerts</h2>
              </header>
              {analysis.safetyAlerts.map((alert, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => syncVideoToChart(alert.timestamp)}
                  className={`p-6 rounded-[2rem] border cursor-pointer transition-all flex items-start gap-4 ${alert.type === 'danger'
                    ? 'bg-red-500/10 border-red-500/20 hover:bg-red-500/20'
                    : 'bg-[#F2CC0D]/10 border-[#F2CC0D]/20 hover:bg-[#F2CC0D]/20'
                    }`}
                >
                  <div className={`size-12 rounded-2xl flex items-center justify-center shrink-0 ${alert.type === 'danger' ? 'bg-red-500 text-white' : 'bg-[#F2CC0D] text-black'
                    }`}>
                    <AlertTriangle size={24} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-white text-lg leading-tight">{alert.message}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Detected at</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded ${alert.type === 'danger' ? 'bg-red-500/20 text-red-500' : 'bg-[#F2CC0D]/20 text-[#F2CC0D]'
                        }`}>
                        {alert.timestamp}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </section>
          )}

        </aside>
      </div>

      {/* SOCIAL INTELLIGENCE DEEP DIVE MODAL */}
      <AnimatePresence>
        {showSocialInsights && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 md:p-12">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSocialInsights(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative w-full max-w-6xl h-[85vh] bg-[#1A1D23] border border-white/10 rounded-[4rem] overflow-hidden shadow-2xl flex flex-col"
            >
              <header className="p-10 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="size-16 bg-[#F2CC0D]/10 rounded-[2rem] flex items-center justify-center text-[#F2CC0D] border border-[#F2CC0D]/20">
                    <Users size={32} />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black tracking-tight text-white uppercase italic">Social Bureau</h2>
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                      <Activity size={12} fill="currentColor" /> Advanced Behavioral Interaction Analysis
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSocialInsights(false)}
                  className="size-14 bg-white/5 rounded-2xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all border border-white/10"
                >
                  <X size={28} />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-10 space-y-8 no-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {analysis?.friends?.map((friend, idx) => {
                    const rel = getRelationshipConfig(friend.relationshipStatus);
                    // Get all interaction timestamps
                    const interactions = friend.timestamps?.length > 0
                      ? friend.timestamps
                      : friend.timestamp ? [{ time: friend.timestamp, duration: friend.duration }] : [];
                    const hasMultipleInteractions = interactions.length > 1;

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="bg-white/5 border border-white/10 rounded-[3rem] p-8 flex flex-col md:flex-row gap-8 hover:border-[#F2CC0D]/30 transition-all group"
                      >
                        <div className="size-32 rounded-[2rem] overflow-hidden bg-slate-900 border-2 border-white/5 shrink-0">
                          {friend.url ? (
                            <img src={friend.url} alt={friend.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Dog size={48} className="text-white/10" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 space-y-4">
                          <header className="flex items-center justify-between">
                            <div>
                              <h3 className="text-2xl font-black text-white">{friend.name}</h3>
                              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{friend.type}</span>
                            </div>
                            <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${rel.bg} ${rel.color}`}>
                              {rel.icon} {friend.relationshipStatus || 'Acquaintance'}
                            </span>
                          </header>
                          <div className="p-4 bg-white/5 border border-white/5 rounded-2xl italic text-xs text-white/80 leading-relaxed ring-1 ring-white/5">
                            "{friend.interactionNature || "A brief encounter in the neighborhood universe."}"
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">Duration</span>
                              <span className="text-lg font-black text-white tabular-nums">{friend.duration || '--'}s</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">Frequency</span>
                              <span className="text-lg font-black text-white tabular-nums">{friend.frequency || interactions.length}x</span>
                            </div>
                          </div>

                          {/* Multiple interaction buttons */}
                          {hasMultipleInteractions ? (
                            <div className="space-y-2">
                              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Jump to Interaction</span>
                              <div className="flex flex-wrap gap-2">
                                {interactions.map((interaction, i) => {
                                  const inHighlight = !!interaction.time;
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => {
                                        if (showOriginalVideo) {
                                          if (interaction.originalTime) syncVideoToChart(interaction.originalTime, interaction.originalTime);
                                          setShowSocialInsights(false);
                                        } else if (inHighlight) {
                                          syncVideoToChart(interaction.time, interaction.originalTime);
                                          setShowSocialInsights(false);
                                        } else if (interaction.originalTime) {
                                          setShowSocialInsights(false);
                                          setPendingOriginalActivity({ label: `${friend.name} interaction ${i + 1}`, time: interaction.originalTime });
                                        }
                                      }}
                                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border ${
                                        !showOriginalVideo && !inHighlight
                                          ? 'bg-white/5 text-white/30 border-white/10'
                                          : 'bg-[#F2CC0D]/10 hover:bg-[#F2CC0D] text-[#F2CC0D] hover:text-black border-[#F2CC0D]/20'
                                      }`}
                                    >
                                      <span className={`size-5 rounded-md flex items-center justify-center ${
                                        !showOriginalVideo && !inHighlight ? 'bg-white/5' : 'bg-[#F2CC0D]/20'
                                      }`}>{i + 1}</span>
                                      <span className="tabular-nums">
                                        {showOriginalVideo
                                          ? interaction.originalTime
                                          : (inHighlight ? interaction.time : interaction.originalTime)}
                                      </span>
                                      {interaction.duration && <span className="opacity-60">({interaction.duration}s)</span>}
                                      {!showOriginalVideo && !inHighlight && <span className="opacity-40 normal-case">(original only)</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (showOriginalVideo) {
                                  if (friend.originalTimestamp) syncVideoToChart(friend.originalTimestamp, friend.originalTimestamp);
                                  setShowSocialInsights(false);
                                } else if (friend.timestamp) {
                                  syncVideoToChart(friend.timestamp, friend.originalTimestamp);
                                  setShowSocialInsights(false);
                                } else if (friend.originalTimestamp) {
                                  setShowSocialInsights(false);
                                  setPendingOriginalActivity({ label: `${friend.name}'s appearance`, time: friend.originalTimestamp });
                                }
                              }}
                              className="w-full py-3 bg-[#F2CC0D] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#F2CC0D]/10"
                            >
                              Jump to Presence
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SCENERY INTELLIGENCE DEEP DIVE MODAL */}
      <AnimatePresence>
        {showSceneryInsights && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 md:p-12 text-white">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSceneryInsights(false)}
              className="absolute inset-0 bg-black/95 backdrop-blur-3xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative w-full max-w-7xl h-[80vh] bg-[#0F1115] border border-white/5 rounded-[3.5rem] overflow-hidden shadow-2xl flex flex-col"
            >
              <header className="p-8 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="size-14 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 border border-blue-500/20">
                    <Mountain size={28} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black tracking-tight uppercase italic">Scenery Analytics</h2>
                    <p className="text-white/30 text-[10px] font-bold uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                      <Activity size={12} fill="currentColor" /> Dwelling Time & Focus Intensity
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSceneryInsights(false)}
                  className="size-12 bg-white/5 rounded-2xl flex items-center justify-center hover:bg-white/10 transition-all border border-white/5 text-white/40"
                >
                  <X size={24} />
                </button>
              </header>

              <div className="flex-1 overflow-hidden flex flex-col relative">
                <div className="flex-1 overflow-y-auto no-scrollbar">
                  <div className="p-8 space-y-12">

                    {/* UNIFIED RELATIVE CONTAINER FOR LAYOUT (Phase 4 - Corrected) */}
                    <div
                      ref={sceneryModalRef}
                      className="relative h-[500px] w-full mt-4 group/container"
                    >

                      {(() => {
                        // ---------------------------------------------------------------------------
                        // DENSE DATA & GEOMETRY CALCULATION
                        // ---------------------------------------------------------------------------
                        // Recharts Margins - MUST MATCH EXACTLY
                        // using explicit values to control the drawing area
                        const chartMargin = { top: 40, right: 30, left: 30, bottom: 20 };

                        const containerHeight = 500;
                        const chartHeight = 260;
                        const chartContainerTop = 240; // Where the Chart DIV starts (y-rel)
                        const xAxisHeight = 30; // Recharts default XAxis height

                        // Drawing Area Calculation
                        // The 'Area' is drawn within (Height - Top - Bottom - XAxisHeight)
                        const drawingHeight = chartHeight - chartMargin.top - chartMargin.bottom - xAxisHeight;

                        // The "Zero Y" (Base of the chart) in relative container coordinates:
                        // relative Y = chartContainerTop + chartMargin.top + drawingHeight
                        // OR simpler: chartContainerTop + chartHeight - chartMargin.bottom - xAxisHeight
                        const zeroYPixels = chartContainerTop + chartHeight - chartMargin.bottom - xAxisHeight;

                        // 1. Determine X-Axis Domain
                        const totalDurationSec = timeToSeconds(analysis.duration || "01:00");
                        const maxSceneryTime = Math.max(...sceneryFocusData.map(s => s.originalSeconds), 0);
                        // Force integers for cleaner matching
                        const finalMaxX = Math.ceil(Math.max(totalDurationSec, maxSceneryTime, 60));

                        // 2. Generate Dense Data (Cumulative Hills)
                        // Increased resolution (0.2s) to ensure smooth curve matching and prevent connectors cutting corners
                        const step = 0.2;
                        const steps = Math.ceil(finalMaxX / step);
                        const denseData = Array.from({ length: steps + 1 }, (_, i) => {
                          const currentSec = i * step;
                          let val = 1; // Base roaming

                          sceneryFocusData.forEach(event => {
                            const eventSec = event.originalSeconds;
                            // Use value first, then try parsing stayDuration, fallback to 5
                            let duration = event.value;
                            if (!duration && event.stayDuration) {
                              duration = typeof event.stayDuration === 'number'
                                ? event.stayDuration
                                : parseFloat(String(event.stayDuration).match(/(\d+(\.\d+)?)/)?.[0] || '5');
                            }
                            duration = duration || 5;
                            const diff = Math.abs(currentSec - eventSec);
                            const range = duration / 2;
                            if (diff < range) {
                              const factor = (Math.cos((diff / range) * Math.PI) + 1) / 2;
                              val += (duration - 1) * factor;
                            }
                          });
                          return { seconds: currentSec, value: val, timeStr: formatTime(currentSec) };
                        });

                        // 3. Determine Y-Axis Domain based on ACTUAL Generated Data
                        // This prevents lines going off chart if overlap creates huge peak
                        const layoutMaxVal = Math.max(...denseData.map(d => d.value), 10);
                        // Add slight headroom (10%) so peak connects comfortably below top edge
                        const finalMaxY = layoutMaxVal * 1.1;

                        // Calculate Chart Area Width based on MODAL WIDTH from Ref
                        // This fixes the bug where we used global containerWidth
                        // Calculate Chart Area Width based on MODAL WIDTH from Ref
                        const activeWidth = sceneryModalWidth || 0; // Don't render until we have width

                        if (!activeWidth) return null; // Wait for ResizeObserver

                        return (
                          <>
                            {/* 1. SVG CONNECTOR OVERLAY (Layer 2) */}
                            <svg
                              className="absolute inset-x-0 inset-y-0 w-full h-full pointer-events-none z-20"
                            >
                              {sceneryFocusData.map((item, idx) => {
                                if (!item.originalSeconds && item.originalSeconds !== 0) return null;

                                // Source (Card)
                                const cardWidth = 240;
                                const gap = 24;
                                const paddingLeft = 64;
                                const cardXCenter = idx * (cardWidth + gap) + (cardWidth / 2) - sceneryScrollLeft + paddingLeft;

                                // Target (Chart)
                                // Use exact originalSeconds for precise positioning (not rounded)
                                const exactTime = item.originalSeconds;

                                // X-Coordinate
                                // Recharts positions the plot area starting at margin.left + yAxisWidth
                                // The plot width = containerWidth - margin.left - margin.right - yAxisWidth
                                const yAxisWidth = 30; // Must match YAxis width prop
                                const chartAreaWidth = activeWidth - chartMargin.left - chartMargin.right - yAxisWidth;
                                const chartX = chartMargin.left + yAxisWidth + (exactTime / finalMaxX) * chartAreaWidth;

                                // Y-Coordinate
                                // READ DIRECTLY from denseData to guarantee we match the rendered curve
                                // This is the ONLY reliable way to match Recharts' actual rendering
                                const step = 0.2;
                                const nearestIndex = Math.round(exactTime / step);
                                const clampedIndex = Math.max(0, Math.min(nearestIndex, denseData.length - 1));
                                const curveValue = denseData[clampedIndex]?.value || 1;

                                const normalizedValue = curveValue / finalMaxY;
                                // Small offset to visually touch surface (not pass through)
                                const endY = zeroYPixels - (normalizedValue * drawingHeight) - 3;

                                // Visibility Check
                                if (cardXCenter < -100 || cardXCenter > activeWidth + 100) return null;

                                return (
                                  <path
                                    key={`connector-${idx}`}
                                    // Bezier Control Points
                                    // Start from Card Base (220px)
                                    d={`M ${cardXCenter} 220 
                                          C ${cardXCenter} ${220 + 60}, ${chartX} ${endY - 60}, ${chartX} ${endY}`}
                                    fill="none"
                                    stroke="#3B82F6"
                                    strokeWidth="2"
                                    strokeDasharray="6 6" // Explicit Dash
                                    strokeOpacity="0.5"
                                    strokeLinecap="round"
                                  />
                                );
                              })}
                            </svg>

                            {/* 2. SCROLLABLE CARDS (Layer 3) */}
                            <div className="absolute top-0 left-0 right-0 h-[220px] z-30">
                              <button
                                onClick={() => sceneryScrollContainerRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                                className="absolute left-4 top-1/2 -translate-y-1/2 z-50 size-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 transition-all text-white/60 hover:text-white"
                              >
                                <ChevronLeft size={20} />
                              </button>
                              <button
                                onClick={() => sceneryScrollContainerRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                                className="absolute right-4 top-1/2 -translate-y-1/2 z-50 size-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 transition-all text-white/60 hover:text-white"
                              >
                                <ChevronRight size={20} />
                              </button>

                              <div
                                ref={sceneryScrollContainerRef}
                                onScroll={handleSceneryScroll}
                                className="flex gap-6 overflow-x-auto px-16 h-full items-center snap-x snap-mandatory scrollbar-hide"
                                style={{ scrollBehavior: 'smooth' }}
                              >
                                {sceneryFocusData.map((item, idx) => (
                                  <motion.div
                                    key={idx}
                                    whileHover={{ y: -5 }}
                                    onClick={() => syncVideoToChart(item.timestamp, item.originalTime)}
                                    className="flex-shrink-0 w-[240px] snap-center cursor-pointer group"
                                  >
                                    <div className="aspect-video relative overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                                      {item.url ? (
                                        <img src={item.url} alt={item.description} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                      ) : (
                                        <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                                          <Mountain size={32} className="text-white/10" />
                                        </div>
                                      )}
                                      <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-1">
                                        <Clock size={8} className="text-white/60" />
                                        <span className="text-[9px] font-black text-white tabular-nums tracking-widest">{formatTime(item.originalSeconds || 0)}</span>
                                      </div>
                                    </div>

                                    <div className="pt-3 px-1 space-y-1.5">
                                      <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest block">
                                        {item.sceneryLabel || "Exploration"}
                                      </span>
                                      <h4 className="text-white text-xs font-bold leading-tight line-clamp-2" title={item.description}>
                                        {item.description}
                                      </h4>
                                      <div className="flex items-center gap-2 pt-2 mt-auto">
                                        <div className="text-[10px] font-black text-white/60 tabular-nums flex items-center gap-1">
                                          <Activity size={10} className="text-white/30" />
                                          {item.stayDuration || 0}s <span className="text-[8px] font-bold text-white/20 uppercase">Focus</span>
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                ))}
                              </div>
                            </div>

                            {/* 3. CHART SECTION (Layer 1) */}
                            <div className="absolute top-[240px] left-0 right-0 h-[260px] px-0 mx-0">
                              {/* NOTE: px-0 here because we are handling margins INSIDE Chart to match SVG */}
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={denseData} margin={chartMargin}>
                                  <defs>
                                    <linearGradient id="modalColorScenery" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.6} />
                                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                  <XAxis
                                    dataKey="seconds"
                                    type="number"
                                    domain={[0, finalMaxX]}
                                    stroke="rgba(255,255,255,0.3)"
                                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold' }}
                                    tickLine={false}
                                    axisLine={false}
                                    dy={10}
                                    tickFormatter={(val) => {
                                      const m = Math.floor(val / 60);
                                      const s = val % 60;
                                      return `${m}:${s.toString().padStart(2, '0')}`;
                                    }}
                                  />
                                  <YAxis
                                    width={30}
                                    domain={[0, finalMaxY]}
                                    stroke="rgba(255,255,255,0.2)"
                                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 'bold' }}
                                    tickLine={false}
                                    axisLine={false}
                                    label={{
                                      value: 'Focus (s)',
                                      angle: -90,
                                      position: 'insideLeft',
                                      fill: 'rgba(255,255,255,0.35)',
                                      fontSize: 10,
                                      fontWeight: 700,
                                      offset: -5
                                    }}
                                    tickFormatter={(value) => `${Math.round(value)}s`}
                                  />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#0F1115', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                    itemStyle={{ color: '#60A5FA', fontWeight: 'bold' }}
                                    formatter={(value: number) => [`${value.toFixed(1)}s`, 'Focus Level']}
                                    labelFormatter={(label) => `Time: ${formatTime(label as number)}`}
                                  />
                                  <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#3B82F6"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#modalColorScenery)"
                                    animationDuration={1500}
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* INDIVIDUAL PREMIUM SOCIAL DETAIL MODAL (Consolidated Trigger) */}
      <AnimatePresence>
        {selectedFriend && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFriend(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#1A1D23] border border-white/10 rounded-[3.5rem] overflow-hidden shadow-2xl flex flex-col md:flex-row"
            >
              {/* Left: Visual & Identity */}
              <div className="w-full md:w-5/12 relative aspect-square md:aspect-auto">
                {selectedFriend.url ? (
                  <img src={selectedFriend.url} alt={selectedFriend.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                    <Dog size={80} className="text-white/10" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#1A1D23] via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#1A1D23]" />

                <button
                  onClick={() => setSelectedFriend(null)}
                  className="absolute top-6 left-6 size-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Right: Social Intelligence */}
              <div className="flex-1 p-10 md:p-12 flex flex-col justify-center space-y-8">
                <header>
                  <div className="flex items-center gap-3 mb-4">
                    {(() => {
                      const rel = getRelationshipConfig(selectedFriend.relationshipStatus);
                      return (
                        <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${rel.bg} ${rel.color}`}>
                          {rel.icon} {selectedFriend.relationshipStatus || 'Acquaintance'}
                        </span>
                      );
                    })()}
                    <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">{selectedFriend.type}</span>
                  </div>
                  <h2 className="text-4xl font-black tracking-tight text-white mb-4">{selectedFriend.name}</h2>
                  <div className="p-4 bg-white/5 border border-white/5 rounded-2xl italic text-sm text-white/80 leading-relaxed">
                    "{selectedFriend.interactionNature || "A brief encounter in the neighborhood universe."}"
                  </div>
                </header>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-white/30">
                      <Clock size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Interaction Duration</span>
                    </div>
                    <p className="text-2xl font-black text-white tabular-nums">{selectedFriend.duration || '--'} <span className="text-xs opacity-40 font-bold uppercase">sec</span></p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-white/30">
                      <Activity size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Visit Frequency</span>
                    </div>
                    <p className="text-2xl font-black text-white tabular-nums">{selectedFriend.frequency || '1'}<span className="text-xs opacity-40 font-bold uppercase">x today</span></p>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                    <span className="text-white/40">Social Bond Strength</span>
                    <span className="text-primary font-bold">In-Depth Analysis</span>
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: selectedFriend.relationshipStatus === 'Bestie' || selectedFriend.relationshipStatus === 'Soulmate' ? '95%' : '40%' }}
                      className="h-full bg-primary"
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (showOriginalVideo) {
                      if (selectedFriend.originalTimestamp) syncVideoToChart(selectedFriend.originalTimestamp, selectedFriend.originalTimestamp);
                      setSelectedFriend(null);
                    } else if (selectedFriend.timestamp) {
                      syncVideoToChart(selectedFriend.timestamp, selectedFriend.originalTimestamp);
                      setSelectedFriend(null);
                    } else if (selectedFriend.originalTimestamp) {
                      setSelectedFriend(null);
                      setPendingOriginalActivity({ label: `${selectedFriend.name}'s appearance`, time: selectedFriend.originalTimestamp });
                    }
                  }}
                  className="w-full py-5 rounded-[2rem] bg-primary text-black font-black uppercase text-xs tracking-[0.3em] hover:scale-105 transition-all shadow-xl shadow-primary/20"
                >
                  Relive Moment
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ACTIVITY JUMP NOTICE */}
      <AnimatePresence>
        {pendingOriginalActivity && !showOriginalVideo && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingOriginalActivity(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 18 }}
              className="relative w-full max-w-lg bg-[#1A1D23] border border-white/10 rounded-[2rem] p-8 shadow-2xl"
            >
              <div className="size-14 bg-[#F2CC0D]/10 rounded-2xl border border-[#F2CC0D]/20 flex items-center justify-center mb-5">
                <Info size={26} className="text-[#F2CC0D]" />
              </div>
              <h3 className="text-2xl font-black text-white mb-3">This Moment Is Outside the Highlight</h3>
              <p className="text-sm text-white/70 leading-relaxed mb-8">
                "{pendingOriginalActivity.label}" at {pendingOriginalActivity.time} is not included in the highlight reel.
                Switch to the original video to view this moment.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPendingOriginalActivity(null)}
                  className="flex-1 px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 font-bold text-sm hover:bg-white/10 transition-all"
                >
                  Stay on Highlight
                </button>
                <button
                  onClick={handleSwitchToOriginalForActivity}
                  className="flex-1 px-5 py-3 rounded-xl bg-[#F2CC0D] text-black font-black text-sm hover:scale-[1.02] transition-all"
                >
                  Switch to Original
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SHARE MODAL */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShareModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#1A1D23] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl p-8"
            >
              <button
                onClick={() => setShowShareModal(false)}
                className="absolute top-6 right-6 size-10 bg-white/5 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>

              <div className="text-center mb-8">
                <div className="size-16 bg-[#F2CC0D]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Share2 size={28} className="text-[#F2CC0D]" />
                </div>
                <h3 className="text-2xl font-black text-white mb-2">Share This Report</h3>
                <p className="text-sm text-white/50">Share {sessionData?.petName || 'your pet'}'s adventure with friends and family</p>
              </div>

              {/* Copy Link */}
              <div className="mb-6">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-2">
                  <div className="flex-1 px-4 py-2 text-sm text-white/60 truncate">
                    {getShareUrl()}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                      linkCopied
                        ? 'bg-green-500 text-white'
                        : 'bg-[#F2CC0D] text-black hover:scale-105'
                    }`}
                  >
                    {linkCopied ? <Check size={16} /> : <Copy size={16} />}
                    {linkCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Share to Discovery */}
              <div className="mb-6 p-4 bg-gradient-to-r from-[#F2CC0D]/10 to-purple-500/10 border border-[#F2CC0D]/20 rounded-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="size-10 bg-[#F2CC0D]/20 rounded-xl flex items-center justify-center">
                    <svg className="size-5 text-[#F2CC0D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Share to Discovery</h4>
                    <p className="text-xs text-white/40">Let the PetDay community see this adventure</p>
                  </div>
                </div>
                <textarea
                  value={discoveryDescription}
                  onChange={(e) => setDiscoveryDescription(e.target.value)}
                  placeholder={`${sessionData?.petName || 'My pet'}'s adventure: ${analysis.title}`}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 resize-none mb-3 focus:outline-none focus:border-[#F2CC0D]/50"
                  rows={2}
                />
                <button
                  onClick={handleShareToDiscovery}
                  disabled={discoverySharing || discoveryShared}
                  className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                    discoveryShared
                      ? 'bg-green-500 text-white'
                      : discoverySharing
                      ? 'bg-[#F2CC0D]/50 text-black/50 cursor-wait'
                      : 'bg-[#F2CC0D] text-black hover:scale-[1.02]'
                  }`}
                >
                  {discoveryShared ? (
                    <><Check size={16} /> Shared to Discovery!</>
                  ) : discoverySharing ? (
                    <><div className="size-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Sharing...</>
                  ) : (
                    <>Share to Discovery</>
                  )}
                </button>
              </div>

              {/* Native Share (Mobile) */}
              {typeof navigator !== 'undefined' && navigator.share && (
                <button
                  onClick={handleNativeShare}
                  className="w-full flex items-center justify-center gap-3 bg-white/5 border border-white/10 px-6 py-4 rounded-2xl font-bold text-sm text-white hover:bg-white/10 transition-all mb-4"
                >
                  <Share2 size={18} /> Share via Device
                </button>
              )}

              {/* Social Share Options */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => handleSocialShare('twitter')}
                  className="flex flex-col items-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-[#1DA1F2]/10 hover:border-[#1DA1F2]/30 transition-all group"
                >
                  <svg className="size-6 text-white/60 group-hover:text-[#1DA1F2] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Twitter</span>
                </button>

                <button
                  onClick={() => handleSocialShare('facebook')}
                  className="flex flex-col items-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-[#1877F2]/10 hover:border-[#1877F2]/30 transition-all group"
                >
                  <svg className="size-6 text-white/60 group-hover:text-[#1877F2] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Facebook</span>
                </button>

                <button
                  onClick={() => handleSocialShare('whatsapp')}
                  className="flex flex-col items-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-[#25D366]/10 hover:border-[#25D366]/30 transition-all group"
                >
                  <svg className="size-6 text-white/60 group-hover:text-[#25D366] transition-colors" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">WhatsApp</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMMENTS SECTION - Only shown for posts shared to Discovery */}
      {isSharedToDiscovery && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-16 mb-32"
        >
          <div className="bg-[#1A1D23] border border-white/10 rounded-[2.5rem] p-8 md:p-10">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="size-12 bg-[#F2CC0D]/10 rounded-2xl flex items-center justify-center">
                  <svg className="size-6 text-[#F2CC0D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">Community Comments</h3>
                  <p className="text-sm text-white/40">{comments.length} comment{comments.length !== 1 ? 's' : ''} from the PetDay community</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-green-500/10 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-green-500/20">
                Shared to Discovery
              </span>
            </div>

            {/* Comment Input */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-gradient-to-br from-[#F2CC0D] to-orange-500 rounded-full flex items-center justify-center text-black font-black text-sm flex-shrink-0">
                  {(commenterName || 'A')[0].toUpperCase()}
                </div>
                <div className="flex-1 space-y-3">
                  <input
                    type="text"
                    value={commenterName}
                    onChange={(e) => setCommenterName(e.target.value)}
                    placeholder="Your name (optional)"
                    className="w-full bg-transparent border-b border-white/10 pb-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#F2CC0D]/50"
                  />
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={`Share your thoughts about ${sessionData?.petName || 'this pet'}'s adventure...`}
                    className="w-full bg-transparent text-sm text-white placeholder:text-white/30 resize-none focus:outline-none min-h-[60px]"
                    rows={2}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSubmitComment}
                      disabled={!newComment.trim() || commentSubmitting}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                        !newComment.trim() || commentSubmitting
                          ? 'bg-white/10 text-white/30 cursor-not-allowed'
                          : 'bg-[#F2CC0D] text-black hover:scale-105'
                      }`}
                    >
                      {commentSubmitting ? (
                        <><div className="size-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Posting...</>
                      ) : (
                        <>Post Comment</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Comments List */}
            <div className="space-y-4">
              {comments.length === 0 ? (
                <div className="text-center py-12">
                  <div className="size-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="size-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <p className="text-white/40 font-medium">No comments yet</p>
                  <p className="text-white/20 text-sm mt-1">Be the first to share your thoughts!</p>
                </div>
              ) : (
                comments.map((comment) => (
                  <motion.div
                    key={comment.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-4 p-4 bg-white/5 rounded-2xl hover:bg-white/[0.07] transition-colors"
                  >
                    <img
                      src={comment.userAvatar}
                      alt={comment.userName}
                      className="size-10 rounded-full object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold text-white text-sm">{comment.userName}</span>
                        <span className="text-white/30 text-xs">
                          {new Date(comment.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <p className="text-white/70 text-sm leading-relaxed">{comment.content}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </motion.section>
      )}

      {/* FOOTER NAV / QUICK ACTIONS */}
      <footer className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-[#1A1D23]/80 backdrop-blur-2xl border border-white/10 px-8 py-4 rounded-[2.5rem] shadow-2xl flex items-center gap-8">
          <button onClick={() => onBack ? onBack() : window.history.back()} className="flex items-center gap-2 text-slate-400 hover:text-white transition-all font-black uppercase text-[10px] tracking-widest">
            <ChevronLeft size={16} /> Back
          </button>
          <div className="w-[1px] h-4 bg-white/10"></div>
          <button className="flex items-center gap-3 text-primary font-black uppercase text-[10px] tracking-[0.2em]">
            <List size={16} /> AI Summary
          </button>
        </div>
      </footer>

      {/* Tailwind / Global Styles Injection */}
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div >
  );
};

export default Analysis;
