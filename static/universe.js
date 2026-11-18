/* =========================================================
   CINEBOT 3.0 — UNIVERSE PAGE CONTROLLER
   Anime | Movies | TV | Discover
   Uses status.js for badges and countdowns when it is loaded.
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const universe = document.body.dataset.universe || "discover";

    const searchInput = document.getElementById("universeSearchInput");
    const searchButton = document.getElementById("universeSearchButton");
    const searchMessage = document.getElementById("universeSearchMessage");

    const genreGrid = document.getElementById("universeGenreGrid");
    const trendingGrid = document.getElementById("universeTrendingGrid");
    const popularGrid = document.getElementById("universePopularGrid");
    const hiddenGrid = document.getElementById("universeHiddenGrid");

    const resultsSection = document.getElementById("universeResultsSection");
    const searchResults = document.getElementById("universeSearchResults");

    const randomButton = document.getElementById("randomDiscoverButton");

    const isDiscover = universe === "discover";

    // Universe name → API category. "movies" becomes "movie" for TMDB.
    const categories = isDiscover
        ? ["anime", "movie", "tv"]
        : [universe === "movies" ? "movie" : universe];

    // Popular results are reused by Hidden Gems so they aren't fetched twice.
    let popularPool = null;

    // -----------------------------------------------------
    // HELPERS
    // -----------------------------------------------------

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    async function fetchJSON(url) {
        const response = await fetch(url);

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error("Invalid server response.");
        }

        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }

        return data;
    }

    function getItems(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== "object") return [];

        if (Array.isArray(data.results)) {
            return data.results;
        }

        if (Array.isArray(data.series) || Array.isArray(data.movies) || Array.isArray(data.other)) {
            return [
                ...(data.series || []),
                ...(data.movies || []),
                ...(data.other || [])
            ];
        }

        return [];
    }

    function getTitle(item) {
        if (!item) return "Untitled";

        if (typeof item.title === "string") return item.title;
        if (typeof item.name === "string") return item.name;

        if (item.title && typeof item.title === "object") {
            return item.title.english || item.title.romaji || item.title.native || "Untitled";
        }

        return "Untitled";
    }

    function getImageURL(item) {
        const poster =
            item?.poster ||
            item?.coverImage?.extraLarge ||
            item?.coverImage?.large ||
            item?.poster_path ||
            "";

        if (!poster) return "";

        if (/^https?:\/\//i.test(poster)) {
            return poster;
        }

        return `https://image.tmdb.org/t/p/w500${poster}`;
    }

    function getRating(item) {
        const rating = item?.rating ?? item?.vote_average ?? item?.averageScore;

        if (rating === undefined || rating === null || rating === "") {
            return "N/A";
        }

        const number = Number(rating);

        if (!Number.isFinite(number) || number <= 0) return "N/A";

        // AniList scores are out of 100; TMDB scores are out of 10.
        return (number > 10 ? number / 10 : number).toFixed(1);
    }

    function getYear(item) {
        return (
            item?.year ||
            item?.release_date?.slice(0, 4) ||
            item?.first_air_date?.slice(0, 4) ||
            item?.startDate?.year ||
            "Unknown year"
        );
    }

    function getDetailsURL(item, category) {
        const id = item?.id;

        if (!id) return "#";

        if (category === "anime") {
            return `/anime/${encodeURIComponent(id)}`;
        }

        return `/details/${encodeURIComponent(category)}/${encodeURIComponent(id)}`;
    }

    // Green/red/amber badge. Empty if status.js did not load or there is no status.
    function statusBadgeHTML(item) {
        if (typeof cbStatusBadge !== "function") return "";

        return cbStatusBadge(item.status);
    }

    // Countdown line for the next episode.
    // Anime uses AniList's exact time; TV uses TMDB's date.
    function nextEpisodeHTML(item, category) {
        if (category === "anime" && typeof cbNextEpisodeLine === "function") {
            return cbNextEpisodeLine(item.nextAiringEpisode);
        }

        if (category === "tv" && typeof cbTvNextEpisodeLine === "function") {
            return cbTvNextEpisodeLine(item.next_episode_to_air);
        }

        return "";
    }

    function showMessage(element, message) {
        if (!element) return;

        element.innerHTML = `
            <div class="universe-empty">
                ${escapeHTML(message)}
            </div>
        `;
    }

    function showLoading(element, message) {
        if (!element) return;

        element.innerHTML = `
            <div class="universe-loading">
                <span class="loading-spinner"></span>
                ${escapeHTML(message)}
            </div>
        `;
    }

    function scrollToResults() {
        if (resultsSection) {
            resultsSection.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    }

    // -----------------------------------------------------
    // CONTENT CARDS
    // -----------------------------------------------------

    function renderCards(container, entries) {
        if (!container) return;

        if (!entries || entries.length === 0) {
            showMessage(container, "No content found. Please try again later.");
            return;
        }

        container.innerHTML = entries.map(({ item, category }) => {
            const title = getTitle(item);
            const poster = getImageURL(item);
            const rating = getRating(item);
            const year = getYear(item);
            const url = getDetailsURL(item, category);

            const image = poster
                ? `
                    <img
                        class="universe-poster"
                        src="${escapeHTML(poster)}"
                        alt="${escapeHTML(title)}"
                        loading="lazy"
                        onerror="this.style.opacity='0.2'"
                    >
                `
                : `<div class="universe-poster"></div>`;

            return `
                <article
                    class="universe-content-card"
                    tabindex="0"
                    role="link"
                    data-url="${escapeHTML(url)}"
                >
                    ${image}

                    <div class="universe-card-info">
                        <h3 title="${escapeHTML(title)}">
                            ${escapeHTML(title)}
                        </h3>

                        <div class="universe-card-meta">
                            <span>${escapeHTML(year)}</span>

                            <span class="universe-card-rating">
                                ★ ${escapeHTML(rating)}
                            </span>
                        </div>

                        ${statusBadgeHTML(item)}
                        ${nextEpisodeHTML(item, category)}
                    </div>
                </article>
            `;
        }).join("");

        container.querySelectorAll(".universe-content-card").forEach(card => {

            const openCard = () => {
                const url = card.dataset.url;

                if (url && url !== "#") {
                    window.location.href = url;
                }
            };

            card.addEventListener("click", openCard);

            card.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCard();
                }
            });
        });
    }

    // -----------------------------------------------------
    // LOAD GENRES
    // -----------------------------------------------------

    async function loadGenres() {
        if (!genreGrid) return;

        // Discover mixes three universes, and TMDB genres need numeric IDs,
        // so genre browsing is limited to a single universe for now.
        if (isDiscover) {
            showMessage(genreGrid, "Choose Movies, TV or Anime to browse by genre.");
            return;
        }

        try {
            let genres;

            if (universe === "anime") {
                const data = await fetchJSON("/api/anime/filters");
                genres = data.genres || [];
            } else {
                const data = await fetchJSON(`/api/filters/${categories[0]}`);
                genres = data.genres || [];
            }

            if (!genres.length) {
                showMessage(genreGrid, "Genres are currently unavailable.");
                return;
            }

            const icons = ["✦", "◈", "◇", "✧", "✺"];

            genreGrid.innerHTML = genres.slice(0, 20).map((genre, index) => {
                const name = typeof genre === "string" ? genre : genre.name || "Genre";
                const id = typeof genre === "string" ? genre : genre.id ?? genre.name;

                return `
                    <button
                        class="universe-genre-card"
                        data-genre="${escapeHTML(id)}"
                        type="button"
                    >
                        <span class="genre-card-icon">${icons[index % icons.length]}</span>
                        <span class="genre-card-name">${escapeHTML(name)}</span>
                    </button>
                `;
            }).join("");

            genreGrid.querySelectorAll(".universe-genre-card").forEach(card => {
                card.addEventListener("click", () => {
                    searchByGenre(card.dataset.genre);
                });
            });

        } catch (error) {
            console.error("Genre loading error:", error);
            showMessage(genreGrid, "Unable to load genres right now.");
        }
    }

    // -----------------------------------------------------
    // LOAD CONTENT
    // -----------------------------------------------------

    async function loadCategoryContent(category, sort) {

        if (category === "anime") {
            const params = new URLSearchParams({
                sort: sort === "trending" ? "TRENDING_DESC" : "POPULARITY_DESC",
                page: "1",
                per_page: "20"
            });

            const data = await fetchJSON(`/api/anime/discover?${params}`);

            return getItems(data).map(item => ({ item, category: "anime" }));
        }

        // Trending uses TMDB's weekly trending list; popular uses discover sorted by popularity.
        const url = sort === "trending"
            ? `/api/trending/${category}`
            : `/api/discover/${category}?${new URLSearchParams({ sort_by: "popularity.desc", page: "1" })}`;

        const data = await fetchJSON(url);

        return getItems(data).map(item => ({ item, category }));
    }

    async function loadContentGrid(container, sort) {
        if (!container) return [];

        try {
            const results = await Promise.all(
                categories.map(category => loadCategoryContent(category, sort))
            );

            const combined = results.flat();

            if (!combined.length) {
                showMessage(container, "No content is available right now.");
                return [];
            }

            if (sort === "popular") {
                popularPool = combined;
            }

            renderCards(container, combined);

            return combined;

        } catch (error) {
            console.error("Content loading error:", error);
            showMessage(container, "Unable to load content. Please try again.");
            return [];
        }
    }

    // -----------------------------------------------------
    // SEARCH
    // -----------------------------------------------------

    async function searchCategory(category, query) {
        const encodedQuery = encodeURIComponent(query);

        if (category === "anime") {
            const data = await fetchJSON(`/api/anime/search?q=${encodedQuery}&page=1`);
            return getItems(data).map(item => ({ item, category: "anime" }));
        }

        const data = await fetchJSON(`/api/search?q=${encodedQuery}&category=${category}&page=1`);
        return getItems(data).map(item => ({ item, category }));
    }

    async function performSearch() {
        const query = searchInput?.value.trim();

        if (!query) {
            if (searchMessage) {
                searchMessage.textContent = "Please enter something to search.";
            }
            return;
        }

        if (searchMessage) {
            searchMessage.textContent = "Searching...";
        }

        if (resultsSection) {
            resultsSection.hidden = false;
        }

        showLoading(searchResults, "Searching...");

        try {
            const results = await Promise.all(
                categories.map(category => searchCategory(category, query))
            );

            const combined = results.flat();

            if (searchMessage) {
                searchMessage.textContent = `${combined.length} result(s) found for "${query}".`;
            }

            renderCards(searchResults, combined);
            scrollToResults();

        } catch (error) {
            console.error("Search error:", error);

            if (searchMessage) {
                searchMessage.textContent = "Search failed. Please try again.";
            }

            showMessage(searchResults, "Unable to complete your search.");
        }
    }

    // -----------------------------------------------------
    // GENRE SEARCH
    // -----------------------------------------------------

    async function searchByGenre(genre) {
        if (!genre || isDiscover) return;

        if (searchMessage) {
            searchMessage.textContent = `Exploring ${genre}...`;
        }

        if (resultsSection) {
            resultsSection.hidden = false;
        }

        showLoading(searchResults, "Finding titles...");

        try {
            const results = await Promise.all(
                categories.map(async category => {

                    if (category === "anime") {
                        const data = await fetchJSON(
                            `/api/anime/discover?genres=${encodeURIComponent(genre)}&page=1`
                        );
                        return getItems(data).map(item => ({ item, category: "anime" }));
                    }

                    const data = await fetchJSON(
                        `/api/discover/${category}?genres=${encodeURIComponent(genre)}&page=1`
                    );
                    return getItems(data).map(item => ({ item, category }));
                })
            );

            const combined = results.flat();

            if (searchMessage) {
                searchMessage.textContent = `Results for ${genre}`;
            }

            renderCards(searchResults, combined);
            scrollToResults();

        } catch (error) {
            console.error("Genre search error:", error);
            showMessage(searchResults, "Unable to load this genre.");
        }
    }

    // -----------------------------------------------------
    // SURPRISE ME (DISCOVER ONLY)
    // -----------------------------------------------------

    async function surpriseMe() {
        if (!randomButton) return;

        randomButton.disabled = true;
        randomButton.textContent = "Finding something...";

        try {
            const pool = await Promise.all(
                categories.map(category => loadCategoryContent(category, "trending"))
            );

            const available = pool.flat();

            if (!available.length) {
                throw new Error("No recommendations available.");
            }

            const selected = available[Math.floor(Math.random() * available.length)];
            const url = getDetailsURL(selected.item, selected.category);

            if (url === "#") {
                throw new Error("Selected item has no valid details URL.");
            }

            window.location.href = url;

        } catch (error) {
            console.error("Random discovery error:", error);
            randomButton.textContent = "Try Again ✦";
            randomButton.disabled = false;
        }
    }

    // -----------------------------------------------------
    // HIDDEN GEMS (DISCOVER ONLY)
    // -----------------------------------------------------

    async function loadHiddenGems() {
        if (!hiddenGrid) return;

        try {
            // Reuse the popular results when they have already loaded.
            const allItems = popularPool || (
                await Promise.all(
                    categories.map(category => loadCategoryContent(category, "popular"))
                )
            ).flat();

            const hidden = allItems
                .filter(({ item, category }) => {
                    const rating = Number(
                        item.rating ?? item.vote_average ?? item.averageScore ?? 0
                    );

                    // Anime scores are out of 100, TMDB scores are out of 10.
                    return rating >= (category === "anime" ? 70 : 7);
                })
                .slice(0, 10);

            if (!hidden.length) {
                showMessage(
                    hiddenGrid,
                    "Explore the Trending and Popular sections for more stories."
                );
                return;
            }

            renderCards(hiddenGrid, hidden);

        } catch (error) {
            console.error("Hidden gems error:", error);
            showMessage(hiddenGrid, "Unable to find hidden gems right now.");
        }
    }

    // -----------------------------------------------------
    // INITIALIZE
    // -----------------------------------------------------

    if (searchButton) {
        searchButton.addEventListener("click", performSearch);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                performSearch();
            }
        });
    }

    if (randomButton) {
        randomButton.addEventListener("click", surpriseMe);
    }

    loadGenres();

    loadContentGrid(trendingGrid, "trending");
    loadContentGrid(popularGrid, "popular").then(() => {
        if (isDiscover) {
            loadHiddenGems();
        }
    });

    // Opens with a search when the page is reached from a link such as
    // /universe/anime?q=One%20Piece (used by the Popular Anime cards on the home page).
    const initialQuery = new URLSearchParams(window.location.search).get("q");

    if (initialQuery && searchInput) {
        searchInput.value = initialQuery;
        performSearch();
    }

});