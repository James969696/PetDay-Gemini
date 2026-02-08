
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { apiUrl } from '../lib/api';

interface Post {
  id: string;
  petName: string;
  petImg: string;
  petBreed: string;
  userName: string;
  userImg: string;
  thumbnail: string;
  highlightVideo?: string;
  likes: number;
  comments: number;
  moodTag: string;
  description: string;
  petType: 'Dog' | 'Cat' | 'Other';
}

const TRENDING_TOPICS = [
  { tag: '#SquirrelChase', posts: '1.2k' },
  { tag: '#GoldenHourPov', posts: '856' },
  { tag: '#MuddyPawsOnly', posts: '2.4k' },
  { tag: '#ParkMeeting', posts: '3.1k' },
  { tag: '#NapTimeChronicles', posts: '942' },
];

const FAKE_USERS = ['Sarah Miller', 'James Wilson', 'Emily Chen', 'Michael Scott', 'Alex Park', 'Mia Thompson'];
const FAKE_DESCRIPTIONS = [
  'An amazing day exploring the neighborhood! Every corner has a new adventure.',
  'Morning patrol through the garden. Nothing gets past these watchful eyes.',
  'Meeting friends at the park — pure joy captured on camera!',
  'A peaceful afternoon walk. Nature is the best playground.',
  'Backyard adventures and endless curiosity. Every sniff tells a story.',
  'The world looks so different from this perspective. What a journey!',
];

function getVisitorId(): string {
  let id = localStorage.getItem('petday_visitor_id');
  if (!id) {
    id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('petday_visitor_id', id);
  }
  return id;
}

function sessionToPost(session: any, index: number): Post | null {
  if (!session || session.status !== 'ready') return null;
  const analysis = session.analysis;
  const firstFriend = analysis?.friends?.[0];
  const petImg = firstFriend?.url || '';
  const petBreed = firstFriend?.breed || firstFriend?.species || 'Mixed';
  const moodTag = analysis?.moodData?.[0]?.name || analysis?.title || 'Adventure';
  const petType = session.petType === 'dog' ? 'Dog' : session.petType === 'cat' ? 'Cat' : 'Other';
  return {
    id: session.id || `post-${index}`,
    petName: session.petName || 'Unknown Pet',
    petImg,
    petBreed,
    userName: FAKE_USERS[index % FAKE_USERS.length],
    userImg: `https://i.pravatar.cc/100?u=${session.id || index}`,
    thumbnail: session.coverUrl || '',
    highlightVideo: session.highlightUrl || undefined,
    likes: 200 + ((index + 1) * 317) % 2000,
    comments: 10 + ((index + 1) * 23) % 150,
    moodTag,
    description: analysis?.summary || FAKE_DESCRIPTIONS[index % FAKE_DESCRIPTIONS.length],
    petType,
  };
}

interface DiscoveryProps {
  onSelect: () => void;
}

const Discovery: React.FC<DiscoveryProps> = ({ onSelect }) => {
  const [filter, setFilter] = useState<'All' | 'Dogs' | 'Cats'>('All');
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const [hoveredPost, setHoveredPost] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [recommendedPets, setRecommendedPets] = useState<{name: string; breed: string; img: string}[]>([]);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    const visitorId = getVisitorId();
    const fetchPosts = async () => {
      try {
        const [sampleRes, sessionRes] = await Promise.all([
          fetch(apiUrl('/api/sample-sessions')),
          fetch(apiUrl(`/api/sessions?visitorId=${encodeURIComponent(visitorId)}`)),
        ]);
        const samples = await sampleRes.json();
        const userSessions = await sessionRes.json();

        const allSessions = [...samples, ...userSessions];
        const seen = new Set<string>();
        const unique = allSessions.filter((s: any) => {
          if (!s.id || seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });

        const built: Post[] = [];
        const friends: {name: string; breed: string; img: string}[] = [];
        unique.forEach((session: any, idx: number) => {
          const post = sessionToPost(session, idx);
          if (post && post.thumbnail) built.push(post);
          // Collect unique friends for sidebar
          const analysis = session.analysis;
          if (analysis?.friends) {
            for (const f of analysis.friends) {
              if (f.url && f.name && friends.length < 6 && !friends.find(x => x.name === f.name)) {
                friends.push({ name: f.name, breed: f.breed || f.species || 'Pet', img: f.url });
              }
            }
          }
        });
        setPosts(built);
        setRecommendedPets(friends.slice(0, 3));
      } catch (err) {
        console.error('Failed to fetch discovery posts:', err);
      }
    };
    fetchPosts();
  }, []);

  const toggleFollow = (name: string) => {
    setFollowed(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const handleMouseEnter = useCallback((postId: string) => {
    setHoveredPost(postId);
    const video = videoRefs.current[postId];
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }, []);

  const handleMouseLeave = useCallback((postId: string) => {
    setHoveredPost(null);
    const video = videoRefs.current[postId];
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, []);

  const filteredPosts = filter === 'All'
    ? posts
    : posts.filter(p => p.petType === (filter === 'Dogs' ? 'Dog' : 'Cat'));

  return (
    <div className="p-8 pb-32 max-w-7xl mx-auto">
      <header className="mb-12 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-primary">Global Feed</span>
          </div>
          <h1 className="text-5xl font-black tracking-tighter">Discovery</h1>
          <p className="text-slate-400 mt-2 text-lg">Explore the world through thousands of other pets' eyes.</p>
        </div>
        
        <div className="flex bg-surface-dark border border-warm-gray/30 p-1.5 rounded-2xl">
          {['All', 'Dogs', 'Cats'].map((f) => (
            <button 
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all ${filter === f ? 'bg-primary text-background-dark shadow-xl' : 'text-slate-400 hover:text-white'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Main Feed */}
        <div className="flex-1 space-y-8">
          <div className="columns-1 md:columns-2 gap-8 space-y-8">
            {filteredPosts.map((post) => (
              <div 
                key={post.id} 
                className="break-inside-avoid bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 overflow-hidden shadow-xl hover:border-primary/50 transition-all group"
              >
                <div
                  className="relative aspect-video cursor-pointer overflow-hidden"
                  onClick={onSelect}
                  onMouseEnter={() => post.highlightVideo && handleMouseEnter(post.id)}
                  onMouseLeave={() => post.highlightVideo && handleMouseLeave(post.id)}
                >
                  <img
                    src={post.thumbnail}
                    alt={post.petName}
                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ${hoveredPost === post.id && post.highlightVideo ? 'opacity-0' : 'opacity-100 group-hover:scale-105'}`}
                  />
                  {post.highlightVideo && (
                    <video
                      ref={(el) => { videoRefs.current[post.id] = el; }}
                      src={post.highlightVideo}
                      muted
                      loop
                      playsInline
                      preload="none"
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${hoveredPost === post.id ? 'opacity-100' : 'opacity-0'}`}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80 pointer-events-none"></div>
                  <div className="absolute top-6 left-6 flex items-center gap-3 z-10">
                    <div className="size-10 rounded-full border-2 border-white/20 overflow-hidden">
                      <img src={post.petImg} alt={post.petName} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-white">{post.petName}</p>
                      <p className="text-[10px] font-bold text-white/50">{post.petBreed}</p>
                    </div>
                  </div>
                  <div className="absolute bottom-6 left-6 z-10">
                     <span className="px-2.5 py-1 bg-primary text-background-dark text-[10px] font-black uppercase rounded-lg">
                       {post.moodTag}
                     </span>
                  </div>
                </div>

                <div className="px-6 pt-4 pb-1">
                  <p className="text-sm font-medium text-slate-300 line-clamp-2 leading-relaxed">
                    {post.description}
                  </p>
                </div>

                <div className="px-6 pb-3 pt-1 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button className="flex items-center gap-2 text-slate-400 hover:text-primary transition-colors group/btn">
                      <span className="material-symbols-outlined !text-xl group-hover/btn:scale-125 transition-transform">favorite</span>
                      <span className="text-xs font-black">{post.likes.toLocaleString()}</span>
                    </button>
                    <button className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                      <span className="material-symbols-outlined !text-xl">chat_bubble</span>
                      <span className="text-xs font-black">{post.comments}</span>
                    </button>
                  </div>
                  <button className="text-slate-400 hover:text-primary transition-colors">
                    <span className="material-symbols-outlined !text-xl">share</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-12 rounded-[3rem] bg-gradient-to-br from-card-dark to-sidebar-dark border border-primary/10 text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-64 h-64 bg-primary/5 blur-[100px] -ml-32 -mt-32"></div>
            <h3 className="text-3xl font-black mb-4">Want to share your pet's moment?</h3>
            <p className="text-slate-400 max-w-xl mx-auto mb-8 font-medium">
              Upload your POV footage and share a highlight reel with the PetDay community.
            </p>
            <button 
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="bg-primary text-background-dark px-10 py-4 rounded-2xl font-black shadow-xl shadow-primary/20 hover:scale-105 transition-all"
            >
              Upload & Post
            </button>
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-8">
          {/* Trending Topics */}
          <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">trending_up</span>
              Trending
            </h2>
            <div className="space-y-6">
              {TRENDING_TOPICS.map((topic) => (
                <div key={topic.tag} className="flex items-center justify-between group cursor-pointer">
                  <div>
                    <p className="text-sm font-bold group-hover:text-primary transition-colors">{topic.tag}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{topic.posts} posts</p>
                  </div>
                  <span className="material-symbols-outlined text-warm-gray/50 group-hover:text-primary transition-colors">chevron_right</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-8 py-3 rounded-xl border border-warm-gray/20 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-white/5 transition-all">
              Show more
            </button>
          </section>

          {/* Pets to Follow */}
          <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl sticky top-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">pets</span>
              Pets to Follow
            </h2>
            <div className="space-y-6">
              {recommendedPets.map((pet) => (
                <div key={pet.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <img src={pet.img} className="size-10 rounded-full border border-white/10 shrink-0" alt={pet.name} />
                    <div className="overflow-hidden">
                      <p className="text-sm font-bold truncate">{pet.name}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase truncate">{pet.breed}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleFollow(pet.name)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${
                      followed[pet.name]
                      ? 'bg-warm-gray/20 text-slate-400'
                      : 'bg-primary text-background-dark shadow-lg shadow-primary/10 hover:shadow-primary/20'
                    }`}
                  >
                    {followed[pet.name] ? 'Following' : 'Follow'}
                  </button>
                </div>
              ))}
            </div>
            <button className="w-full mt-8 py-3 rounded-xl border border-warm-gray/20 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-white/5 transition-all">
              View all
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default Discovery;
