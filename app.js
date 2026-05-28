/**
 * ANIVERSE — Core Application Logic
 * Restructured for Root-level GitHub Actions Delivery
 */

const CONFIG = {
    STREAMP2P_API_KEY: "46d3af3546d3931092a5b078",
    STREAMP2P_API_BASE: "https://streamp2p.com/api/v1",
    STREAMP2P_EMBED_BASE: "https://streamp2p.com/v/", // Verified correct embed format
    JIKAN_API_BASE: "https://api.jikan.moe/v4",
    ANILIST_API_BASE: "https://graphql.anilist.co",
    MAL_CLIENT_ID: "2489021155a7437ecdf738b1cc049a51"
};

const state = {
    library: {}, // Map: { anime_name: { soft: [], hard: [], dub: [] } }
    ongoing: [],
    watchlist: [],
    settings: {
        apiKey: CONFIG.STREAMP2P_API_KEY,
        defaultSub: 'soft',
        dataSource: 'mal',
        autoMonitor: true,
        autoSync: true
    },
    currentView: 'home'
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    loadPersistence();
    initUI();
    initEventListeners();
    
    if (state.settings.autoSync) {
        syncLibrary();
    }
    
    loadHomePage();
});

function initUI() {
    renderGenres();
    renderAZList();
}

function initEventListeners() {
    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('side-menu').classList.toggle('active');
    });

    document.getElementById('settings-btn').addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('filter-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openModal('filter-modal');
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.modal').classList.remove('active'));
    });

    const headerSearch = document.getElementById('header-search');
    headerSearch.addEventListener('input', debounce((e) => handleSearch(e.target.value), 400));

    document.getElementById('sync-btn').addEventListener('click', syncLibrary);
    document.getElementById('save-settings').addEventListener('click', saveSettings);
}

// --- HOME PAGE LOADING ---

async function loadHomePage() {
    try {
        const trendingRes = await fetch(`${CONFIG.JIKAN_API_BASE}/top/anime?filter=airing&limit=15`);
        const trendingData = await trendingRes.json();
        renderCarousel('trending-carousel', trendingData.data);
        
        if (trendingData.data.length > 0) {
            updateHero(trendingData.data[0]);
        }

        const recentRes = await fetch(`${CONFIG.JIKAN_API_BASE}/top/anime?limit=12`);
        const recentData = await recentRes.json();
        renderGrid('recent-grid', recentData.data);

        const ongoingRes = await fetch(`${CONFIG.JIKAN_API_BASE}/seasons/now?limit=12`);
        const ongoingData = await ongoingRes.json();
        renderGrid('ongoing-grid', ongoingData.data);

    } catch (error) {
        console.error("Error loading home page:", error);
    }
}

function updateHero(anime) {
    const banner = document.getElementById('hero-banner');
    if (banner && anime.images.jpg.large_image_url) {
        banner.style.backgroundImage = `url(${anime.images.jpg.large_image_url})`;
    }
}

// --- CORE UI RENDERING ---

function createAnimeCard(anime) {
    const title = anime.title_english || anime.title;
    const score = anime.score || 'N/A';
    const episodes = anime.episodes || '?';
    const image = anime.images.jpg.large_image_url;
    const type = anime.type || 'TV';
    const year = anime.year || (anime.aired?.from ? anime.aired.from.split('-')[0] : '');
    const isSynced = checkLibraryForAnime(title);

    return `
        <div class="anime-card" onclick="openAnimeDetails(${anime.mal_id})">
            <div class="card-img-container">
                <img src="${image}" alt="${title}" loading="lazy">
                <div class="card-badge badge-status">${anime.status === 'Currently Airing' ? 'Airing' : 'Finished'}</div>
                <div class="card-badge badge-score"><i class="fas fa-star"></i> ${score}</div>
                <div class="card-badge badge-episodes">${episodes} EPS</div>
                ${isSynced ? '<div class="card-badge synced-badge">SYNCED</div>' : ''}
                <div class="card-overlay">
                    <div class="play-icon"><i class="fas fa-play"></i></div>
                </div>
            </div>
            <div class="card-info">
                <h3>${title}</h3>
                <div class="card-meta">${type} • ${year}</div>
            </div>
        </div>
    `;
}

function renderCarousel(id, list) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = list.map(a => createAnimeCard(a)).join('');
}

function renderGrid(id, list) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = list.map(a => createAnimeCard(a)).join('');
}

// --- SEARCH SYSTEM ---

async function handleSearch(query) {
    const dropdown = document.getElementById('search-dropdown');
    if (!query || query.length < 2) {
        dropdown.classList.add('hidden');
        return;
    }

    dropdown.classList.remove('hidden');
    dropdown.innerHTML = '<div class="loader">Searching...</div>';

    try {
        const malRes = await fetch(`${CONFIG.JIKAN_API_BASE}/anime?q=${encodeURIComponent(query)}&limit=5`);
        const malData = await malRes.json();

        const aniListQuery = `
        query ($search: String) {
            Page(page: 1, perPage: 5) {
                media(search: $search, type: ANIME, isAdult: false) {
                    id idMal title { romaji english }
                    coverImage { medium }
                    meanScore episodes
                }
            }
        }`;

        const aniListRes = await fetch(CONFIG.ANILIST_API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: aniListQuery, variables: { search: query } })
        });
        const aniListData = await aniListRes.json();

        renderSearchDropdown(malData.data, aniListData.data.Page.media);
    } catch (error) {
        console.error("Search error:", error);
    }
}

function renderSearchDropdown(malResults, aniResults) {
    const dropdown = document.getElementById('search-dropdown');
    const results = [...malResults];
    
    aniResults.forEach(ani => {
        if (!results.find(m => m.mal_id === ani.idMal)) {
            results.push({
                mal_id: ani.idMal,
                title: ani.title.english || ani.title.romaji,
                images: { jpg: { small_image_url: ani.coverImage.medium } },
                score: ani.meanScore / 10,
                episodes: ani.episodes
            });
        }
    });

    if (results.length === 0) {
        dropdown.innerHTML = '<div class="no-results">No results found</div>';
        return;
    }

    dropdown.innerHTML = results.slice(0, 8).map(anime => {
        const title = anime.title_english || anime.title;
        return `
            <div class="search-item" onclick="openAnimeDetails(${anime.mal_id})">
                <img src="${anime.images.jpg.small_image_url || anime.images.jpg.image_url}">
                <div class="search-item-info">
                    <div class="search-item-title">${title}</div>
                    <div class="search-item-meta">${anime.type || 'TV'} • ${anime.score || 'N/A'} Score</div>
                </div>
                ${checkLibraryForAnime(title) ? '<span class="library-badge">IN LIBRARY</span>' : ''}
            </div>
        `;
    }).join('');
}

// --- WATCH MODAL & PLAYER ---

async function openAnimeDetails(malId) {
    openModal('watch-modal');
    const container = document.getElementById('anime-detail-view');
    container.innerHTML = '<div class="loader">Loading details...</div>';

    try {
        const res = await fetch(`${CONFIG.JIKAN_API_BASE}/anime/${malId}/full`);
        const data = await res.json();
        const anime = data.data;
        const title = anime.title_english || anime.title;
        
        const libraryData = checkLibraryForAnime(title);
        renderAnimeDetail(anime, libraryData);
    } catch (error) {
        container.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

function renderAnimeDetail(anime, libraryData) {
    const container = document.getElementById('anime-detail-view');
    const title = anime.title_english || anime.title;
    
    container.innerHTML = `
        <div class="detail-header" style="background-image: url(${anime.images.jpg.large_image_url})">
            <div class="detail-overlay"></div>
            <div class="detail-info-wrap">
                <img src="${anime.images.jpg.large_image_url}" class="detail-poster">
                <div class="detail-text">
                    <h1>${title}</h1>
                    <div class="detail-meta">
                        <span>${anime.year || ''}</span>
                        <span>${anime.status}</span>
                        <span>${anime.episodes || '?'} Episodes</span>
                        <span class="score-tag"><i class="fas fa-star"></i> ${anime.score || 'N/A'}</span>
                    </div>
                    <div class="detail-genres">
                        ${anime.genres.map(g => `<span class="genre-tag">${g.name}</span>`).join('')}
                    </div>
                    <p class="synopsis">${anime.synopsis || 'No synopsis available.'}</p>
                    <div class="detail-actions">
                        <button class="primary-btn" onclick="startWatching('${title}')"><i class="fas fa-play"></i> Watch Now</button>
                        <button class="secondary-btn"><i class="fas fa-plus"></i> Watchlist</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="watch-section">
            <div class="sub-dub-toggle">
                <button class="toggle-btn ${state.settings.defaultSub === 'soft' ? 'active' : ''}" onclick="switchSubType('${title}', 'soft')">Soft Sub</button>
                <button class="toggle-btn ${state.settings.defaultSub === 'hard' ? 'active' : ''}" onclick="switchSubType('${title}', 'hard')">Hard Sub</button>
                <button class="toggle-btn ${state.settings.defaultSub === 'dub' ? 'active' : ''}" onclick="switchSubType('${title}', 'dub')">English Dub</button>
            </div>
            
            <div id="video-player-container" class="video-container">
                <div class="player-placeholder">Select an episode to start watching</div>
            </div>

            <div class="episode-list">
                <h3>Episodes</h3>
                <div class="episode-grid" id="episode-grid-container">
                    ${renderEpisodeGrid(title, state.settings.defaultSub)}
                </div>
            </div>
        </div>
    `;
}

function renderEpisodeGrid(animeTitle, subType) {
    const animeData = state.library[animeTitle.toLowerCase()];
    const episodes = animeData ? (animeData[subType] || []) : [];
    
    if (episodes.length === 0) {
        return `<div class="coming-soon-small">No ${subType} episodes available yet.</div>`;
    }

    return episodes.map((ep, index) => `
        <button class="ep-btn" onclick="playEpisode('${ep.id}')">EP ${index + 1}</button>
    `).join('');
}

function playEpisode(videoId) {
    const container = document.getElementById('video-player-container');
    // Correct embed URL format for StreamP2P
    const embedUrl = `${CONFIG.STREAMP2P_EMBED_BASE}${videoId}`;
    container.innerHTML = `<iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>`;
}

// --- LIBRARY SYNC LOGIC ---

async function syncLibrary() {
    console.log("Syncing with StreamP2P...");
    try {
        const response = await fetch(`${CONFIG.STREAMP2P_API_BASE}/video/folder`, {
            headers: { 'api-token': state.settings.apiKey }
        });
        const folders = await response.json();
        
        const animeRoot = folders.find(f => f.name.toLowerCase() === 'anime');
        if (!animeRoot) return;

        const animeFolders = folders.filter(f => f.parentId === animeRoot.id);
        
        for (const folder of animeFolders) {
            const animeName = folder.name.toLowerCase();
            state.library[animeName] = { soft: [], hard: [], dub: [] };
            
            // Fetch videos in this folder
            const vRes = await fetch(`${CONFIG.STREAMP2P_API_BASE}/video/folder/${folder.id}`, {
                headers: { 'api-token': state.settings.apiKey }
            });
            const vData = await vRes.json();
            const videos = vData.videos || [];
            
            // Simple sorting into types based on filename or folder structure
            videos.forEach(v => {
                const name = v.name.toLowerCase();
                if (name.includes('dub')) state.library[animeName].dub.push(v);
                else if (name.includes('hard')) state.library[animeName].hard.push(v);
                else state.library[animeName].soft.push(v);
            });
        }
        
        savePersistence();
        console.log("Library synced successfully.");
    } catch (error) {
        console.error("Sync failed:", error);
    }
}

function checkLibraryForAnime(title) {
    return state.library[title.toLowerCase()] || null;
}

// --- UTILITIES ---

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function renderGenres() {
    const genres = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural"];
    const menu = document.getElementById('menu-genres');
    const filter = document.getElementById('filter-genres');
    if (menu) menu.innerHTML = genres.map(g => `<a href="#" class="genre-pill">${g}</a>`).join('');
    if (filter) filter.innerHTML = genres.map(g => `<div class="genre-pill-item">${g}</div>`).join('');
}

function renderAZList() {
    const az = "0-9 ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(' ');
    const footer = document.getElementById('footer-az');
    const menu = document.getElementById('menu-az');
    const html = az.map(l => `<button class="az-btn">${l}</button>`).join('');
    if (footer) footer.innerHTML = html;
    if (menu) menu.innerHTML = html;
}

function saveSettings() {
    state.settings.apiKey = document.getElementById('setting-api-key').value;
    state.settings.defaultSub = document.getElementById('setting-sub-type').value;
    state.settings.dataSource = document.getElementById('setting-data-source').value;
    state.settings.autoMonitor = document.getElementById('setting-auto-monitor').checked;
    state.settings.autoSync = document.getElementById('setting-auto-sync').checked;
    savePersistence();
    alert("Settings saved!");
}

function loadPersistence() {
    const saved = localStorage.getItem('aniverse_state');
    if (saved) Object.assign(state, JSON.parse(saved));
}

function savePersistence() {
    localStorage.setItem('aniverse_state', JSON.stringify(state));
}
