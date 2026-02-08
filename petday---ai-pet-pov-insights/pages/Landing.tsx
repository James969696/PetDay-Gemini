
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

const LANDING_TIMELINE = [
  { time: '00:00', seconds: 0, label: 'Rise & Shine', icon: 'wb_sunny' },
  { time: '01:12', seconds: 72, label: 'Sniff Patrol', icon: 'search' },
  { time: '03:05', seconds: 185, label: 'Park Zoomies', icon: 'directions_run' },
  { time: '05:30', seconds: 330, label: 'Buddy Reunion', icon: 'groups' },
  { time: '07:48', seconds: 468, label: 'Zen Chill', icon: 'pets' },
];

const LANDING_MOOD_DATA = [
  { seconds: 0, value: 30 },
  { seconds: 30, value: 35 },
  { seconds: 72, value: 60 },
  { seconds: 100, value: 55 },
  { seconds: 140, value: 70 },
  { seconds: 185, value: 95 },
  { seconds: 220, value: 85 },
  { seconds: 260, value: 70 },
  { seconds: 300, value: 65 },
  { seconds: 330, value: 80 },
  { seconds: 370, value: 75 },
  { seconds: 410, value: 60 },
  { seconds: 440, value: 50 },
  { seconds: 468, value: 45 },
];

const MAX_SECONDS = 468;

const formatLandingTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

interface LandingProps {
  onStart: () => void;
}

const Landing: React.FC<LandingProps> = ({ onStart }) => {
  // Refs for Activity & Mood Sync dynamic connector lines
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const moodChartRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [moodChartTop, setMoodChartTop] = useState(0);
  const [moodChartHeight, setMoodChartHeight] = useState(280);
  const [cardBottomY, setCardBottomY] = useState(0);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft);
    }
  }, []);

  useEffect(() => {
    const measure = () => {
      if (chartWrapperRef.current) setContainerWidth(chartWrapperRef.current.offsetWidth);
      if (chartWrapperRef.current) {
        const wrapperRect = chartWrapperRef.current.getBoundingClientRect();
        if (moodChartRef.current) {
          const chartRect = moodChartRef.current.getBoundingClientRect();
          setMoodChartTop(chartRect.top - wrapperRect.top);
          setMoodChartHeight(chartRect.height);
        }
        // Measure card bottom: find the first card element inside scroll container
        const firstCard = scrollContainerRef.current?.querySelector(':scope > div') as HTMLElement | null;
        if (firstCard) {
          const cardRect = firstCard.getBoundingClientRect();
          setCardBottomY(cardRect.bottom - wrapperRect.top);
        }
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const timer = setTimeout(measure, 300);
    return () => { window.removeEventListener('resize', measure); clearTimeout(timer); };
  }, []);
  return (
    <div className="bg-background-dark min-h-screen text-white overflow-x-hidden selection:bg-primary selection:text-background-dark">
      {/* Navigation */}
      <header className="fixed top-0 w-full z-50 bg-background-dark/90 backdrop-blur-xl border-b border-warm-gray/20">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-background-dark p-2 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined font-black text-2xl">pets</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">PetDay</h1>
          </div>
          <nav className="hidden md:flex items-center gap-12">
            <a className="text-sm font-bold text-slate-400 hover:text-primary transition-colors" href="#features">Features</a>
            <a className="text-sm font-bold text-slate-400 hover:text-primary transition-colors" href="#how-it-works">How it Works</a>
            <a className="text-sm font-bold text-slate-400 hover:text-primary transition-colors" href="#stories">Stories</a>
          </nav>
          <div className="flex items-center gap-4">
            <button className="text-sm font-bold text-slate-300 hover:text-white transition-colors px-4">Log in</button>
            <button onClick={onStart} className="bg-primary text-background-dark px-8 py-3 rounded-full text-sm font-black hover:shadow-2xl hover:shadow-primary/40 transition-all hover:-translate-y-0.5 active:translate-y-0">
              Launch App
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-48 pb-32 px-6 overflow-hidden">
        {/* Background Ambience */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden pointer-events-none opacity-30">
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[160px] -mr-96 -mt-96"></div>
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] -ml-64 -mb-32"></div>
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex flex-col items-center text-center gap-10 mb-24">
            {/* AI Badge */}
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm animate-fade-in">
              <div className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Intelligence by Gemini 3</span>
            </div>
            
            {/* Centered Headline */}
            <div className="max-w-5xl">
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[5.5rem] font-black leading-[1.1] tracking-tighter">
                <span className="block md:whitespace-nowrap">What if your best friend could</span> 
                <span className="text-primary italic block drop-shadow-[0_0_30px_rgba(242,204,13,0.4)]">
                  tell you their story?
                </span>
              </h1>
            </div>

            {/* Centered Subtext */}
            <div className="max-w-2xl">
              <p className="text-lg md:text-xl text-slate-400 leading-relaxed font-medium">
                PetDay — AI Pet POV Video Insights
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-center gap-5">
              <button 
                onClick={onStart}
                className="bg-primary text-background-dark px-10 py-5 rounded-2xl text-lg font-black flex items-center justify-center gap-3 hover:shadow-2xl hover:shadow-primary/30 transition-all hover:-translate-y-1 active:translate-y-0 group"
              >
                Unlock Their World
                <span className="material-symbols-outlined text-2xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
              <button className="bg-white/5 border border-white/10 px-10 py-5 rounded-2xl text-lg font-black flex items-center justify-center gap-3 hover:bg-white/10 transition-all">
                Watch Sample
              </button>
            </div>

            {/* Centered Social Proof */}
            <div className="flex flex-col items-center gap-4 mt-4">
              <div className="flex -space-x-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="size-11 rounded-full border-2 border-background-dark overflow-hidden bg-warm-gray">
                    <img src={`https://i.pravatar.cc/100?u=${i + 30}`} alt="user" />
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="text-sm font-black text-white">4,200+ Proud Pet Parents</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Discovering the secret life of pets</p>
              </div>
            </div>
          </div>

          {/* Featured Showcase Card - Centered within the flow */}
          <div className="relative group max-w-6xl mx-auto">
            <div className="absolute -inset-4 bg-primary/10 rounded-[4rem] blur-3xl group-hover:bg-primary/20 transition-all duration-1000"></div>
            <div className="relative rounded-[3.5rem] overflow-hidden border border-white/10 shadow-3xl aspect-[21/9] bg-surface-dark">
              <img 
                src="https://images.unsplash.com/photo-1558929996-da64ba858215?q=80&w=1600" 
                alt="Pet POV" 
                className="w-full h-full object-cover transition-transform duration-[6s] group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent"></div>
              
              {/* Floating AI Vision Elements */}
              <div className="absolute top-10 left-10 flex flex-col gap-4">
                <div className="p-4 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl animate-float shadow-2xl">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-sm">visibility</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Focus Object</p>
                      <p className="text-sm font-bold text-white">Golden Retriever Buddy</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl animate-float-delayed shadow-2xl">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                      <span className="material-symbols-outlined text-sm">sentiment_satisfied</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Sentiment</p>
                      <p className="text-sm font-bold text-white">Peak Excitement</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-10 left-10 right-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div className="text-left">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="px-3 py-1 bg-primary text-background-dark text-[10px] font-black uppercase rounded-lg">LIVE ANALYSIS</span>
                    <span className="text-white/40 text-xs font-bold font-mono">REC 00:04:22:15</span>
                  </div>
                  <h3 className="text-4xl font-black text-white mb-2">Cooper's Morning Social</h3>
                  <p className="text-slate-300 font-medium max-w-lg">Capturing the first meeting of the day with his favorite park friend.</p>
                </div>
                
                <div className="flex items-center gap-4 bg-white/5 backdrop-blur-xl p-4 rounded-3xl border border-white/10">
                  <div className="size-12 rounded-2xl bg-primary text-background-dark flex items-center justify-center shadow-xl">
                    <span className="material-symbols-outlined font-black">insights</span>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">AI Summary</p>
                    <p className="text-sm font-bold text-white">High Social Confidence</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="how-it-works" className="pt-24 pb-32 px-6 bg-surface-dark/30 relative">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-center mb-16">
            <div className="relative max-w-2xl w-full">
              <div className="absolute inset-0 bg-primary/20 rounded-[3rem] blur-3xl opacity-20"></div>
              <img src="/cam.jpg" alt="PetDay Camera Design" className="relative w-full rounded-[2.5rem] border border-white/10 shadow-2xl" />
              <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-t from-black/90 via-black/50 to-transparent"></div>
              <div className="absolute bottom-0 left-0 right-0 p-10 lg:p-14 text-center">
                <div className="text-primary font-black text-sm mb-4 uppercase tracking-[0.4em]">The Experience</div>
                <h2 className="text-3xl lg:text-5xl font-black mb-4 tracking-tight text-white">Walk a mile in their paws.</h2>
                <p className="text-sm lg:text-base text-white/70 leading-relaxed max-w-xl mx-auto">Simply attach a lightweight camera to your pet's collar, go about your day, and let our AI translate their world for you.</p>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-12">
            {[
              { step: '01', title: 'Capture the POV', desc: 'Any lightweight pet camera works. Let them roam and explore freely.', icon: 'camera_front' },
              { step: '02', title: 'AI Storyteller', desc: 'Gemini AI spots friends, mood peaks, and heart-warming highlights.', icon: 'psychology' },
              { step: '03', title: 'Relive the Magic', desc: 'Get a cinematic highlight reel and insights into their hidden daily life.', icon: 'auto_awesome' },
            ].map((item, idx) => (
              <div key={idx} className="group p-10 rounded-[3rem] bg-background-dark border border-white/5 hover:border-primary/20 transition-all text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                  <span className="text-8xl font-black text-white">{item.step}</span>
                </div>
                <div className="size-20 rounded-3xl bg-surface-dark flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform shadow-xl">
                  <span className="material-symbols-outlined text-primary text-4xl">{item.icon}</span>
                </div>
                <h3 className="text-2xl font-black mb-4">{item.title}</h3>
                <p className="text-slate-500 font-medium leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header + 3 Feature Cards (horizontal) */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Advanced Analytics</span>
            </div>
            <h2 className="text-5xl lg:text-6xl font-black mb-12 leading-[1.1] tracking-tighter">Everything they see, <br/>now understood.</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: 'Mood Mapping', desc: 'Visualize your pet\u2019s emotional rollercoaster throughout the day with detailed charts.', icon: 'trending_up' },
                { title: 'Social Network', desc: 'Automatically identify which pets and humans they interact with most often.', icon: 'groups' },
                { title: 'Territory Tracking', desc: 'See where they spend their time and what scenery peaks their curiosity.', icon: 'explore' },
              ].map((feat, i) => (
                <div key={i} className="flex flex-col items-center gap-4 p-8 bg-surface-dark border border-white/10 rounded-3xl text-center hover:border-primary/20 transition-all">
                  <div className="size-14 rounded-2xl bg-primary/10 shrink-0 flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined text-primary text-2xl">{feat.icon}</span>
                  </div>
                  <h4 className="text-xl font-bold">{feat.title}</h4>
                  <p className="text-slate-500 font-medium leading-relaxed text-sm">{feat.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Two showcase cards side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
            {/* Activity & Mood Sync Card */}
            <div className="relative h-full">
              <div className="absolute inset-0 bg-primary/20 rounded-[3rem] blur-3xl opacity-30"></div>
              <div className="relative p-8 rounded-[3rem] bg-surface-dark border border-white/10 shadow-3xl overflow-hidden h-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex flex-col gap-1 text-left">
                    <h4 className="font-black text-lg text-white uppercase tracking-tight">Activity & Mood Sync</h4>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Correlating pet behavior with emotional peaks</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full border border-primary/20">
                    <span className="size-2 rounded-full bg-primary animate-pulse"></span>
                    <span className="text-[10px] font-black text-primary uppercase tracking-widest">Excitement Index</span>
                  </div>
                </div>

                <div className="relative pt-10" ref={chartWrapperRef}>
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
                    {containerWidth > 0 && LANDING_TIMELINE.map((event, idx) => {
                      const startY = cardBottomY;
                      const chartMarginRight = 30;
                      const yAxisWidth = 30;
                      const plotWidth = containerWidth - chartMarginRight - yAxisWidth;
                      const xChart = yAxisWidth + (event.seconds / MAX_SECONDS) * plotWidth;

                      // Linearly interpolate mood value at exact event.seconds
                      let interpValue = LANDING_MOOD_DATA[0].value;
                      for (let di = 1; di < LANDING_MOOD_DATA.length; di++) {
                        const prev = LANDING_MOOD_DATA[di - 1];
                        const curr = LANDING_MOOD_DATA[di];
                        if (event.seconds <= curr.seconds) {
                          const t = (event.seconds - prev.seconds) / (curr.seconds - prev.seconds || 1);
                          interpValue = prev.value + t * (curr.value - prev.value);
                          break;
                        }
                        if (di === LANDING_MOOD_DATA.length - 1) interpValue = curr.value;
                      }

                      const chartMarginTop = 80;
                      const xAxisHeight = 30;
                      const drawingHeight = moodChartHeight - chartMarginTop - xAxisHeight;
                      const endY = moodChartTop + chartMarginTop + drawingHeight - (interpValue / 100) * drawingHeight;
                      const cardWidth = 256;
                      const gap = 16;
                      const paddingLeft = 40;
                      const cardXCenter = idx * (cardWidth + gap) + (cardWidth / 2) - scrollLeft + paddingLeft;
                      if (cardXCenter < -50 || cardXCenter > containerWidth + 50) return null;
                      const midY = startY + (endY - startY) * 0.35;
                      return (
                        <path
                          key={idx}
                          d={`M ${cardXCenter} ${startY} C ${cardXCenter} ${midY}, ${xChart} ${midY}, ${xChart} ${endY}`}
                          stroke="#F2CC0D"
                          strokeWidth="2"
                          strokeDasharray="6 4"
                          fill="none"
                          strokeOpacity={Math.max(0.15, 1 - Math.abs(cardXCenter - xChart) / 800)}
                        />
                      );
                    })}
                  </svg>

                  <div className="relative group/timeline z-20">
                    <div
                      ref={scrollContainerRef}
                      onScroll={handleScroll}
                      className="flex gap-4 overflow-x-auto pb-10 scrollbar-hide snap-x no-scrollbar px-10"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {LANDING_TIMELINE.map((event, idx) => (
                        <div
                          key={idx}
                          className="flex-shrink-0 w-64 p-6 bg-white/5 border border-white/10 rounded-3xl text-left snap-start group hover:border-primary/30 transition-all shadow-xl backdrop-blur-sm cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-primary font-black text-xs tracking-tighter tabular-nums px-2 py-1 bg-primary/10 rounded-lg">{event.time}</span>
                            <span className="material-symbols-outlined text-white/20 group-hover:text-primary transition-colors !text-xl overflow-hidden max-w-[24px]">{event.icon}</span>
                          </div>
                          <p className="font-bold text-sm text-white/80 group-hover:text-white transition-colors uppercase tracking-tight line-clamp-2 leading-relaxed">
                            {event.label}
                          </p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => scrollContainerRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                      className="absolute left-[10px] top-[128px] -translate-y-1/2 size-10 bg-primary text-background-dark rounded-full flex items-center justify-center shadow-2xl opacity-0 group-hover/timeline:opacity-100 transition-opacity z-10"
                    >
                      <span className="material-symbols-outlined !text-xl">chevron_left</span>
                    </button>
                    <button
                      onClick={() => scrollContainerRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                      className="absolute right-[10px] top-[128px] -translate-y-1/2 size-10 bg-primary text-background-dark rounded-full flex items-center justify-center shadow-2xl opacity-0 group-hover/timeline:opacity-100 transition-opacity z-10"
                    >
                      <span className="material-symbols-outlined !text-xl">chevron_right</span>
                    </button>
                  </div>

                  <div ref={moodChartRef} className="h-[280px] w-full mt-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={LANDING_MOOD_DATA} margin={{ top: 80, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="landingColorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F2CC0D" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#F2CC0D" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                          dataKey="seconds"
                          type="number"
                          domain={[0, MAX_SECONDS]}
                          stroke="rgba(255,255,255,0.2)"
                          fontSize={10}
                          fontWeight="bold"
                          axisLine={false}
                          tickLine={false}
                          tick={{ dy: 10 }}
                          interval="preserveStartEnd"
                          tickFormatter={(val) => formatLandingTime(val as number)}
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
                          labelStyle={{ color: 'white', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase' as const, fontWeight: 900 }}
                          labelFormatter={(val) => `Time: ${formatLandingTime(val as number)}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#F2CC0D"
                          strokeWidth={4}
                          fillOpacity={1}
                          fill="url(#landingColorValue)"
                          animationDuration={2000}
                        />
                        {LANDING_TIMELINE.map((event, idx) => (
                          <ReferenceLine
                            key={idx}
                            x={event.seconds}
                            stroke="#F2CC0D"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                            strokeOpacity={0.2}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Social Network Card */}
            <div className="relative h-full">
              <div className="absolute inset-0 bg-primary/20 rounded-[3rem] blur-3xl opacity-20"></div>
              <div className="relative p-8 rounded-[3rem] bg-surface-dark border border-white/10 shadow-3xl overflow-hidden h-full">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="size-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary border border-primary/20">
                      <span className="material-symbols-outlined text-2xl">groups</span>
                    </div>
                    <div className="flex flex-col gap-1 text-left">
                      <h4 className="font-black text-lg text-white uppercase tracking-tight">Social Network</h4>
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">AI-Detected Social Interactions</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full border border-primary/20">
                    <span className="size-2 rounded-full bg-primary animate-pulse"></span>
                    <span className="text-[10px] font-black text-primary uppercase tracking-widest">Live</span>
                  </div>
                </div>

                {/* Frosty - Featured Friend Card */}
                <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 hover:border-primary/30 transition-all group mb-5">
                  <div className="flex gap-5">
                    <div className="size-24 rounded-2xl overflow-hidden bg-slate-900 border-2 border-white/5 shrink-0">
                      <img src="https://petday-api-707197108816.us-central1.run.app/api/sample-asset/sample-luna/friend-friend-Frosty-mosaic-3-bbel0o-friend-cropped-198slu.jpg" alt="Frosty" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                    </div>
                    <div className="flex-1 space-y-3 text-left">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-xl font-black text-white">Frosty</h3>
                          <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Domestic Shorthair</span>
                        </div>
                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-green-500/10 text-green-400">
                          <span className="material-symbols-outlined !text-xs">favorite</span> Bestie
                        </span>
                      </div>
                      <div className="p-3 bg-white/5 border border-white/5 rounded-xl italic text-xs text-white/80 leading-relaxed">
                        "Chasing, sniffing, and close-up face-to-face greetings"
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-0.5">Duration</span>
                          <span className="text-lg font-black text-white tabular-nums">42s</span>
                        </div>
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-0.5">Frequency</span>
                          <span className="text-lg font-black text-white tabular-nums">6x</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Other Friends - Compact List */}
                <div className="space-y-3">
                  {[
                    { name: 'Tiger', type: 'Tabby Cat', rel: 'Soulmate', relColor: 'text-pink-400', relBg: 'bg-pink-500/10', icon: 'local_fire_department', duration: '31s', freq: '4x', img: 'https://petday-api-707197108816.us-central1.run.app/api/sample-asset/sample-luna/friend-friend-Tiger-mosaic-3-sft1p7-friend-cropped-wcg7ni.jpg' },
                    { name: 'Marmalade', type: 'Tabby Cat', rel: 'Bestie', relColor: 'text-green-400', relBg: 'bg-green-500/10', icon: 'favorite', duration: '19s', freq: '2x', img: 'https://petday-api-707197108816.us-central1.run.app/api/sample-asset/sample-luna/friend-friend-Marmalade-mosaic-3-hsy2iq-friend-cropped-louzy.jpg' },
                    { name: 'Patch', type: 'Domestic Shorthair', rel: 'Acquaintance', relColor: 'text-blue-400', relBg: 'bg-blue-500/10', icon: 'group', duration: '5s', freq: '1x', img: 'https://petday-api-707197108816.us-central1.run.app/api/sample-asset/sample-luna/friend-friend-Patch-mosaic-4-c2x4e-friend-cropped-nwj959.jpg' },
                  ].map((f, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-white/20 transition-all">
                      <div className="size-12 rounded-xl overflow-hidden bg-slate-900 border border-white/5 shrink-0">
                        <img src={f.img} alt={f.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-white">{f.name}</span>
                          <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">{f.type}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] font-bold text-white/40">
                          <span className="tabular-nums">{f.duration}</span>
                          <span className="tabular-nums">{f.freq}</span>
                        </div>
                      </div>
                      <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${f.relBg} ${f.relColor}`}>
                        <span className="material-symbols-outlined !text-xs">{f.icon}</span> {f.rel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center mt-12">
            <button
              onClick={onStart}
              className="bg-primary text-background-dark px-10 py-5 rounded-2xl text-lg font-black flex items-center justify-center gap-3 hover:shadow-2xl hover:shadow-primary/30 transition-all hover:-translate-y-1 active:translate-y-0 group"
            >
              Unlock Their World
              <span className="material-symbols-outlined text-2xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-20 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-background-dark p-2 rounded-xl">
              <span className="material-symbols-outlined font-black text-2xl">pets</span>
            </div>
            <span className="text-2xl font-black text-white">PetDay</span>
          </div>
          <div className="flex flex-wrap justify-center gap-12 text-sm font-bold text-slate-400">
            <a href="#" className="hover:text-primary transition-colors">Privacy</a>
            <a href="#" className="hover:text-primary transition-colors">Terms</a>
            <a href="#" className="hover:text-primary transition-colors">Twitter</a>
            <a href="#" className="hover:text-primary transition-colors">Instagram</a>
          </div>
          <p className="text-sm font-medium text-slate-600">© 2024 PetDay AI. Created for pet lovers.</p>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(10px); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float { animation: float 4s ease-in-out infinite; }
        .animate-float-delayed { animation: float-delayed 5s ease-in-out infinite; }
        .animate-fade-in { animation: fade-in 0.8s ease-out forwards; }
      `}} />
    </div>
  );
};

export default Landing;
