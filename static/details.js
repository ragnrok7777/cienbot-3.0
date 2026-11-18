/* =========================================================
   CINEBOT 3.0 — MOVIE / TV DETAILS PAGE
========================================================= */

const COUNTRY_NAMES = {
    IN: "India",
    US: "United States",
    GB: "United Kingdom",
    JP: "Japan",
    DE: "Germany",
    KR: "South Korea",
    FR: "France",
    CA: "Canada",
    AU: "Australia"
};

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

const detailsContainer = document.getElementById("movieDetails");

if (detailsContainer) {

    const category = detailsContainer.dataset.category;
    const itemId = detailsContainer.dataset.itemId;

    // -----------------------------------------------------
    // HELPERS
    // -----------------------------------------------------

    function showError(message) {
        detailsContainer.innerHTML = `
            <div class="details-error">
                <h2>Something went wrong</h2>
                <p>${escapeHTML(message)}</p>
                <button type="button" onclick="loadDetails()">
                    Try Again
                </button>
            </div>
        `;
    }

    function imageURL(path, size = "w500") {
        return path ? `https://image.tmdb.org/t/p/${size}${path}` : "";
    }

    function createProviderList(providers, heading, title) {
        if (!providers || providers.length === 0) {
            return "";
        }

        return `
            <div class="provider-group">
                <h3>${escapeHTML(heading)}</h3>

                <div class="provider-grid">
                    ${providers.map(provider => {
                        const name = provider.provider_name || "Unknown";

                        const searchURL = name === "Netflix"
                            ? `https://www.netflix.com/search?q=${encodeURIComponent(title)}`
                            : `https://www.google.com/search?q=${encodeURIComponent(`${title} watch on ${name}`)}`;

                        const logo = provider.logo_path
                            ? `<img src="${imageURL(provider.logo_path, "w92")}" alt="${escapeHTML(name)}">`
                            : "";

                        return `
                            <a class="provider-card"
                               href="${escapeHTML(searchURL)}"
                               target="_blank"
                               rel="noopener noreferrer">

                                ${logo}

                                <strong>${escapeHTML(name)}</strong>
                                <small>Find to watch ↗</small>
                            </a>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    }

    function createOTTSection(countryCode, providerData, title) {
        const ottData = providerData[countryCode] || {};

        const types = [
            ["flatrate", "Stream"],
            ["free", "Free"],
            ["ads", "Free with Ads"],
            ["rent", "Rent"],
            ["buy", "Buy"]
        ];

        const content = types
            .map(([type, heading]) => createProviderList(ottData[type], heading, title))
            .join("");

        return content || `
            <p class="no-ott">
                No OTT availability information found for this country.
            </p>
        `;
    }

    // -----------------------------------------------------
    // LOAD AND RENDER
    // -----------------------------------------------------

    async function loadDetails() {

        detailsContainer.innerHTML = `
            <div class="details-loading">
                <div class="magic-orb"></div>
                <h2>Opening the multiverse...</h2>
                <p>Summoning ${escapeHTML(category === "tv" ? "TV show" : "movie")} details</p>
            </div>
        `;

        try {
            const response = await fetch(`/api/details/${category}/${itemId}`);

            let movie;

            try {
                movie = await response.json();
            } catch {
                throw new Error("The server returned an invalid response.");
            }

            if (!response.ok) {
                throw new Error(movie?.error || `Server error (${response.status}).`);
            }

            // Watch providers are optional. If they fail, the rest of the page still loads.
            let providerData = {};

            try {
                const providerResponse = await fetch(`/api/providers/${category}/${itemId}`);

                if (providerResponse.ok) {
                    const data = await providerResponse.json();
                    providerData = data.results || {};
                }
            } catch (error) {
                console.error("Provider loading error:", error);
            }

            const title = movie.title || movie.name || movie.original_title || "Unknown title";
            const overview = movie.overview || "No description available.";
            const poster = imageURL(movie.poster_path, "w500");
            const backdrop = imageURL(movie.backdrop_path, "original");

            const year = (movie.release_date || movie.first_air_date || "").slice(0, 4);

            const genres = (movie.genres || [])
                .map(genre => genre.name)
                .join(", ");

            const runtimeMinutes = movie.runtime || movie.episode_run_time?.[0];

            const runtime = runtimeMinutes
                ? `${runtimeMinutes} minutes`
                : "Not available";

            const rating = movie.vote_average
                ? `${Number(movie.vote_average).toFixed(1)}/10`
                : "Not available";

            const director = category === "movie"
                ? (movie.credits?.crew || []).find(person => person.job === "Director")?.name
                : null;

            const cast = (movie.credits?.cast || []).slice(0, 8);

            const similar = (movie.similar?.results || []).slice(0, 8);

            const trailer = (movie.videos?.results || []).find(video =>
                video.site === "YouTube" && video.type === "Trailer"
            );

            const backdropStyle = backdrop
                ? `style="background-image: linear-gradient(90deg, #050F18 5%, #050F1899 65%, #050F1855), url('${escapeHTML(backdrop)}')"`
                : "";

            const countryOptions = Object.entries(COUNTRY_NAMES)
                .map(([code, name]) => `
                    <option value="${escapeHTML(code)}" ${code === "IN" ? "selected" : ""}>
                        ${escapeHTML(name)}
                    </option>
                `)
                .join("");

            detailsContainer.innerHTML = `
                ${backdrop ? `<div class="details-backdrop" ${backdropStyle}></div>` : ""}

                <section class="movie-hero">

                    <div class="poster-container">
                        ${poster
                            ? `<img class="movie-poster" src="${escapeHTML(poster)}" alt="${escapeHTML(title)} poster">`
                            : `<div class="poster-placeholder">POSTER UNAVAILABLE</div>`
                        }
                    </div>

                    <div class="movie-information">

                    

                        <h1>
                            ${escapeHTML(title)}
                            ${year ? `<span>(${escapeHTML(year)})</span>` : ""}
                        </h1>

                        <div class="movie-meta">
                            <span>⭐ ${escapeHTML(rating)}</span>
                            <span>🎭 ${escapeHTML(genres || "Unknown genre")}</span>
                            <span>⏱ ${escapeHTML(runtime)}</span>
                        </div>

                        ${director ? `
                            <p class="director">
                                <strong>Director:</strong> ${escapeHTML(director)}
                            </p>
                        ` : ""}

                        <h2>THE STORY</h2>

                        <p class="movie-overview">${escapeHTML(overview)}</p>

                        ${trailer ? `
                            <a class="trailer-button"
                               href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}"
                               target="_blank"
                               rel="noopener noreferrer">
                                ▶ WATCH TRAILER
                            </a>
                        ` : ""}

                    </div>

                </section>

                <section class="details-section">
                    <h2>✦ THE CAST</h2>

                    <div class="cast-grid">
                        ${cast.length
                            ? cast.map(person => `
                                <div class="cast-card cast-person">
                                    ${person.profile_path
                                        ? `<img class="cast-photo" src="${imageURL(person.profile_path, "w185")}" alt="${escapeHTML(person.name)}">`
                                        : `<div class="cast-photo cast-photo-empty">${escapeHTML((person.name || "?").charAt(0))}</div>`
                                    }
                                    <div class="cast-text">
                                        <strong>${escapeHTML(person.name)}</strong>
                                        <span>${escapeHTML(person.character || "Unknown role")}</span>
                                    </div>
                                </div>
                            `).join("")
                            : `<p>Cast information unavailable.</p>`
                        }
                    </div>
                </section>

                ${similar.length ? `
                    <section class="details-section">
                        <h2>✦ MORE LIKE THIS</h2>

                        <div class="similar-grid">
                            ${similar.map(item => `
                                <a class="similar-card"
                                   href="/details/${escapeHTML(category)}/${encodeURIComponent(item.id)}">
                                    ${item.poster_path
                                        ? `<img class="similar-poster" src="${imageURL(item.poster_path, "w342")}" alt="${escapeHTML(item.title || item.name || "Poster")}">`
                                        : `<div class="similar-poster"></div>`
                                    }
                                    <strong>${escapeHTML(item.title || item.name || "Untitled")}</strong>
                                    <span>${escapeHTML((item.release_date || item.first_air_date || "").slice(0, 4) || "Unknown year")}</span>
                                </a>
                            `).join("")}
                        </div>
                    </section>
                ` : ""}

                <section class="details-section ott-section">

                    <h2>✦ WHERE TO WATCH</h2>

                    <label for="countrySelect">Select your country</label>

                    <select id="countrySelect">
                        ${countryOptions}
                    </select>

                    <div id="ottResults">
                        ${createOTTSection("IN", providerData, title)}
                    </div>

                </section>
            `;

            const countrySelect = document.getElementById("countrySelect");
            const ottResults = document.getElementById("ottResults");

            countrySelect.addEventListener("change", () => {
                ottResults.innerHTML = createOTTSection(
                    countrySelect.value,
                    providerData,
                    title
                );
            });

        } catch (error) {
            console.error("Details loading error:", error);
            showError(error.message || "Could not load details.");
        }
    }

    window.loadDetails = loadDetails;

    loadDetails();
}