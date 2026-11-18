import os
import time
import requests

from concurrent.futures import ThreadPoolExecutor
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# =====================================================
# CINEBOT 3.0 — CONFIGURATION
# =====================================================

load_dotenv()

app = Flask(__name__)

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
TMDB_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_URL = "https://image.tmdb.org/t/p/w500"
ANILIST_URL = "https://graphql.anilist.co"

TIMEOUT = 20
RESULTS_PER_PAGE = 20

ANIME_FORMATS = {"TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}
ANIME_STATUSES = {"RELEASING", "FINISHED", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"}
ANIME_SEASONS = {"WINTER", "SPRING", "SUMMER", "FALL"}

ALLOWED_ANIME_SORTS = {
    "POPULARITY_DESC",
    "POPULARITY",
    "SCORE_DESC",
    "SCORE",
    "TRENDING_DESC",
    "START_DATE_DESC",
    "START_DATE",
    "TITLE_ROMAJI",
    "TITLE_ENGLISH",
    "FAVOURITES_DESC"
}

# Fields requested for every anime result in the discovery query.
ANIME_FIELDS = """
            id
            title { romaji english native }
            description
            coverImage { large extraLarge }
            bannerImage
            episodes
            averageScore
            format
            status
            genres
            tags { name }
            startDate { year }
            season
            seasonYear
            nextAiringEpisode { episode airingAt timeUntilAiring }
"""

# TMDB uses its own TV status names. Convert them to the AniList names
# so the same badge code works for anime and TV shows.
TV_STATUS_TO_ANILIST = {
    "Returning Series": "RELEASING",
    "In Production": "NOT_YET_RELEASED",
    "Planned": "NOT_YET_RELEASED",
    "Pending": "NOT_YET_RELEASED",
    "Ended": "FINISHED",
    "Canceled": "CANCELLED",
    "Cancelled": "CANCELLED"
}

# Cache of TV status lookups, so each show is only fetched once an hour.
TV_STATUS_CACHE = {}
TV_STATUS_CACHE_SECONDS = 3600


# =====================================================
# HELPER FUNCTIONS
# =====================================================

def tmdb_get(endpoint, params=None):

    if not TMDB_API_KEY:
        raise ValueError("TMDB API key is missing. Check your .env file.")

    request_params = {"api_key": TMDB_API_KEY}

    if params:
        request_params.update(params)

    response = requests.get(
        f"{TMDB_URL}{endpoint}",
        params=request_params,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


# =====================================================
# ANILIST API
# =====================================================

def anilist_post(query, variables=None):

    response = requests.post(
        ANILIST_URL,
        json={
            "query": query,
            "variables": variables or {}
        },
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        timeout=TIMEOUT
    )

    try:
        result = response.json()

    except ValueError:
        response.raise_for_status()
        raise ValueError("AniList returned an invalid response.")

    # Read GraphQL errors before raising HTTP errors.
    if result.get("errors"):

        error_message = result["errors"][0].get(
            "message",
            "Unknown AniList GraphQL error"
        )

        raise ValueError(f"AniList error: {error_message}")

    response.raise_for_status()

    return result.get("data", {})


def image_url(path):

    if path:
        return f"{TMDB_IMAGE_URL}{path}"

    return None


def parse_int(value, default=None, minimum=None, maximum=None):

    try:
        number = int(value)

    except (TypeError, ValueError):
        return default

    if minimum is not None and number < minimum:
        return default

    if maximum is not None and number > maximum:
        return default

    return number


def parse_float(value, default=None, minimum=None, maximum=None):

    try:
        number = float(value)

    except (TypeError, ValueError):
        return default

    if minimum is not None and number < minimum:
        return default

    if maximum is not None and number > maximum:
        return default

    return number


def parse_csv(value):

    if not value:
        return []

    return [
        item.strip()
        for item in value.split(",")
        if item.strip()
    ]


def get_page(default=1):

    return parse_int(
        request.args.get("page"),
        default,
        1,
        500
    ) or default


def api_error(message, status=500):

    return jsonify({"error": message}), status


def tmdb_result(item, category):

    release_date = (
        item.get("release_date")
        or item.get("first_air_date")
        or ""
    )

    return {
        "id": item.get("id"),
        "title": item.get("title") or item.get("name"),
        "overview": item.get("overview", ""),
        "poster": image_url(item.get("poster_path")),
        "backdrop": image_url(item.get("backdrop_path")),
        "year": release_date[:4],
        "release_date": release_date,
        "rating": item.get("vote_average"),
        "media_type": category,
        "popularity": item.get("popularity"),

        # Filled in later for TV shows by add_tv_airing_info().
        "status": None,
        "next_episode_to_air": None
    }


def fetch_tv_airing_info(show_id):

    cached = TV_STATUS_CACHE.get(show_id)
    now = time.time()

    if cached and now - cached[0] < TV_STATUS_CACHE_SECONDS:
        return cached[1]

    try:
        data = tmdb_get(f"/tv/{show_id}")

    except (ValueError, requests.RequestException) as error:
        print("TMDB TV STATUS ERROR:", show_id, error)
        return {"status": None, "next_episode_to_air": None}

    info = {
        "status": TV_STATUS_TO_ANILIST.get(data.get("status")),
        "next_episode_to_air": data.get("next_episode_to_air")
    }

    TV_STATUS_CACHE[show_id] = (now, info)

    return info


def add_tv_airing_info(results):

    ids = [item["id"] for item in results if item.get("id")]

    # Fetch all shows at the same time instead of one after another.
    with ThreadPoolExecutor(max_workers=8) as pool:
        infos = dict(zip(ids, pool.map(fetch_tv_airing_info, ids)))

    for item in results:
        info = infos.get(item.get("id"), {})
        item["status"] = info.get("status")
        item["next_episode_to_air"] = info.get("next_episode_to_air")

    return results


def anilist_result(item):

    title = item.get("title") or {}
    cover = item.get("coverImage") or {}
    start_date = item.get("startDate") or {}

    return {
        "id": item.get("id"),

        "title": (
            title.get("english")
            or title.get("romaji")
            or title.get("native")
            or "Untitled"
        ),

        "description": item.get("description") or "",

        "poster": (
            cover.get("extraLarge")
            or cover.get("large")
        ),

        "banner": item.get("bannerImage"),
        "episodes": item.get("episodes"),
        "rating": item.get("averageScore"),
        "format": item.get("format"),
        "status": item.get("status"),
        "genres": item.get("genres") or [],

        # AniList returns "tags": null for some titles, so default to an empty list.
        "tags": [
            tag.get("name")
            for tag in (item.get("tags") or [])
            if tag.get("name")
        ],

        "year": start_date.get("year"),
        "season": item.get("season"),
        "seasonYear": item.get("seasonYear"),

        # Next episode date and number. None when the show has finished.
        "nextAiringEpisode": item.get("nextAiringEpisode")
    }


# =====================================================
# HOME PAGE
# =====================================================

@app.route("/")
def home():

    return render_template("index.html")


# =====================================================
# UNIVERSE PAGES
# =====================================================

@app.route("/universe/<universe>")
def universe_page(universe):

    universe = universe.lower()

    universes = {

        "anime": {
            "name": "Anime Universe",
            "category": "anime",
            "eyebrow": "ENTER THE ANIMATION WORLD",
            "description": "Explore incredible anime, legendary adventures and unforgettable characters.",
            "icon": "✦"
        },

        "movies": {
            "name": "Movie Universe",
            "category": "movie",
            "eyebrow": "ENTER THE CINEMATIC WORLD",
            "description": "Discover blockbusters, timeless classics and hidden cinematic gems.",
            "icon": "▣"
        },

        "tv": {
            "name": "TV Universe",
            "category": "tv",
            "eyebrow": "ENTER THE SERIES WORLD",
            "description": "Explore incredible television series and discover your next obsession.",
            "icon": "▤"
        }

    }

    if universe not in universes:
        return render_template("404.html"), 404

    return render_template(
        "universe.html",
        universe=universes[universe],
        universe_type=universe
    )


# =====================================================
# DISCOVER UNIVERSE
# =====================================================

@app.route("/discover")
def discover_page():

    discover = {
        "name": "Discover Universe",
        "category": "all",
        "eyebrow": "EXPLORE THE MULTIVERSE",
        "description": "One destination for anime, movies and television. Find something unexpected.",
        "icon": "◈"
    }

    return render_template(
        "universe.html",
        universe=discover,
        universe_type="discover"
    )


# =====================================================
# MOVIE AND TV SEARCH
# =====================================================

@app.route("/api/search")
def search_content():

    query = request.args.get("q", "").strip()

    category = request.args.get("category", "movie").lower()

    page = get_page()

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    if not query:

        return jsonify({
            "results": [],
            "page": page,
            "total_pages": 0,
            "total_results": 0
        })

    try:

        data = tmdb_get(
            f"/search/{category}",
            {
                "query": query,
                "include_adult": False,
                "page": page
            }
        )

        results = [
            tmdb_result(item, category)
            for item in data.get("results", [])
        ]

        if category == "tv":
            add_tv_airing_info(results)

        return jsonify({
            "results": results,
            "page": data.get("page", page),
            "total_pages": data.get("total_pages", 0),
            "total_results": data.get("total_results", 0)
        })

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB SEARCH ERROR:", error)
        return api_error("Movie/TV search failed.", 502)


# =====================================================
# MOVIE AND TV GENRES
# =====================================================

@app.route("/api/filters/<category>")
def get_tmdb_filters(category):

    category = category.lower()

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    try:

        data = tmdb_get(
            f"/genre/{category}/list",
            {"language": "en-US"}
        )

        return jsonify({
            "category": category,
            "genres": data.get("genres", [])
        })

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB GENRE ERROR:", error)
        return api_error("Could not load genres.", 502)


# =====================================================
# MOVIE AND TV TRENDING
# =====================================================

@app.route("/api/trending/<category>")
def trending_tmdb(category):

    category = category.lower()

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    try:

        data = tmdb_get(f"/trending/{category}/week")

        results = [
            tmdb_result(item, category)
            for item in data.get("results", [])
        ]

        if category == "tv":
            add_tv_airing_info(results)

        return jsonify({
            "results": results,
            "page": 1,
            "total_pages": data.get("total_pages", 1),
            "total_results": data.get("total_results", 0)
        })

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB TRENDING ERROR:", error)
        return api_error("Could not load trending content.", 502)


# =====================================================
# MOVIE AND TV DISCOVERY
# =====================================================

@app.route("/api/discover/<category>")
def discover_tmdb(category):

    category = category.lower()

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    page = get_page()

    allowed_sorts = {
        "popularity.asc",
        "popularity.desc",
        "vote_average.asc",
        "vote_average.desc",
        "vote_count.asc",
        "vote_count.desc",
        "primary_release_date.asc",
        "primary_release_date.desc",
        "release_date.asc",
        "release_date.desc",
        "revenue.asc",
        "revenue.desc",
        "original_title.asc",
        "original_title.desc",
        "first_air_date.asc",
        "first_air_date.desc",
        "name.asc",
        "name.desc"
    }

    sort_by = request.args.get("sort_by", "popularity.desc")

    if sort_by not in allowed_sorts:
        sort_by = "popularity.desc"

    params = {
        "language": "en-US",
        "page": page,
        "include_adult": "false",
        "sort_by": sort_by
    }

    genres = parse_csv(request.args.get("genres"))

    if genres:
        params["with_genres"] = ",".join(genres)

    year = parse_int(request.args.get("year"), None, 1870, 2200)

    if year:

        if category == "movie":
            params["primary_release_year"] = year

        else:
            params["first_air_date_year"] = year

    language = request.args.get("with_original_language", "").strip()

    if language:
        params["with_original_language"] = language[:10]

    country = request.args.get("country", "").strip()

    if country:

        if category == "movie":
            params["region"] = country[:10]

        else:
            params["with_origin_country"] = country[:10]

    rating = parse_float(request.args.get("rating"), None, 0, 10)

    if rating is not None:
        params["vote_average.gte"] = rating

    votes = parse_int(request.args.get("votes"), None, 0, 100000000)

    if votes is not None:
        params["vote_count.gte"] = votes

    if category == "tv":

        status = request.args.get("status", "").strip()

        if status in {"0", "1", "2", "3", "4", "5"}:
            params["with_status"] = status

        air_type = request.args.get("air_type", "").strip()

        if air_type in {"0", "1", "2", "3", "4", "5", "6"}:
            params["with_type"] = air_type

    try:

        data = tmdb_get(f"/discover/{category}", params)

        results = [
            tmdb_result(item, category)
            for item in data.get("results", [])
        ]

        if category == "tv":
            add_tv_airing_info(results)

        return jsonify({
            "results": results,
            "page": data.get("page", page),
            "total_pages": data.get("total_pages", 0),
            "total_results": data.get("total_results", 0)
        })

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB DISCOVER ERROR:", error)
        return api_error("Could not load filtered results.", 502)


# =====================================================
# MOVIE AND TV DETAILS
# =====================================================

@app.route("/details/<category>/<int:item_id>")
def details_page(category, item_id):

    if category not in ["movie", "tv"]:
        return "Invalid category", 404

    return render_template(
        "movie.html",
        category=category,
        item_id=item_id
    )


@app.route("/api/details/<category>/<int:item_id>")
def get_details(category, item_id):

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    try:

        data = tmdb_get(
            f"/{category}/{item_id}",
            {"append_to_response": "credits,videos,similar"}
        )

        return jsonify(data)

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB DETAILS ERROR:", error)
        return api_error("Could not load details.", 502)


# =====================================================
# WATCH PROVIDERS
# =====================================================

@app.route("/api/providers/<category>/<int:item_id>")
def get_providers(category, item_id):

    if category not in ["movie", "tv"]:
        return api_error("Invalid category.", 400)

    try:

        data = tmdb_get(f"/{category}/{item_id}/watch/providers")

        return jsonify(data)

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB PROVIDERS ERROR:", error)
        return api_error("Could not load providers.", 502)


# =====================================================
# ANIME GENRES AND TAGS
# =====================================================

@app.route("/api/anime/filters")
def anime_filters():

    query = """
    query {
        GenreCollection
        MediaTagCollection {
            id
            name
            description
            category
            isAdult
        }
    }
    """

    try:

        data = anilist_post(query)

        tags = [
            tag
            for tag in (data.get("MediaTagCollection") or [])
            if not tag.get("isAdult")
        ]

        return jsonify({
            "genres": data.get("GenreCollection") or [],
            "tags": tags,
            "formats": sorted(ANIME_FORMATS),
            "statuses": sorted(ANIME_STATUSES),
            "seasons": sorted(ANIME_SEASONS)
        })

    except (requests.RequestException, ValueError) as error:

        print("ANILIST FILTER ERROR:", error)

        return api_error(f"Could not load anime filters: {error}", 502)


# =====================================================
# ANIME STUDIO SEARCH
# =====================================================

@app.route("/api/anime/studios")
def search_anime_studios():

    search = request.args.get("q", "").strip()

    if not search:
        return jsonify({"results": []})

    query = """
    query ($search: String) {
        Studio(search: $search) {
            id
            name
        }
    }
    """

    try:

        data = anilist_post(query, {"search": search})
        studio = data.get("Studio")

        return jsonify({
            "results": [studio] if studio else []
        })

    except (requests.RequestException, ValueError) as error:

        print("ANILIST STUDIO ERROR:", error)

        return api_error(f"Could not search studios: {error}", 502)


# =====================================================
# ANIME SEARCH
# =====================================================

@app.route("/api/anime/search")
def search_anime():

    search = request.args.get("q", "").strip()
    page = get_page()

    if not search:

        return jsonify({
            "series": [],
            "movies": [],
            "other": [],
            "pageInfo": {
                "currentPage": page,
                "hasNextPage": False,
                "lastPage": 1,
                "perPage": RESULTS_PER_PAGE,
                "total": 0
            }
        })

    query = """
    query ($search: String, $page: Int, $perPage: Int) {

        Page(page: $page, perPage: $perPage) {

            pageInfo {
                currentPage
                hasNextPage
                lastPage
                perPage
                total
            }

            media(search: $search, type: ANIME) {

                id

                title {
                    romaji
                    english
                    native
                }

                description

                coverImage {
                    large
                    extraLarge
                }

                bannerImage
                episodes
                averageScore
                format
                status
                genres

                tags {
                    name
                }

                startDate {
                    year
                }

                season
                seasonYear
                nextAiringEpisode { episode airingAt timeUntilAiring }
            }
        }
    }
    """

    try:

        data = anilist_post(
            query,
            {
                "search": search,
                "page": page,
                "perPage": RESULTS_PER_PAGE
            }
        )

        page_data = data.get("Page", {})
        media_list = page_data.get("media", [])

        series = []
        movies = []
        other = []

        for anime in media_list:

            item = anilist_result(anime)
            anime_format = anime.get("format")

            if anime_format == "MOVIE":
                movies.append(item)

            elif anime_format in ["TV", "TV_SHORT"]:
                series.append(item)

            else:
                other.append(item)

        return jsonify({
            "series": series,
            "movies": movies,
            "other": other,
            "pageInfo": page_data.get("pageInfo", {})
        })

    except (requests.RequestException, ValueError) as error:

        print("ANILIST SEARCH ERROR:", error)

        return api_error(f"Anime search failed: {error}", 502)

    except (KeyError, TypeError) as error:

        print("ANILIST SEARCH PROCESSING ERROR:", error)

        return api_error("Could not process anime results.", 502)


# =====================================================
# ANIME ADVANCED DISCOVERY
# =====================================================

@app.route("/api/anime/discover")
def discover_anime():

    genres = parse_csv(request.args.get("genres"))
    tags = parse_csv(request.args.get("tags"))

    formats = [
        item for item in parse_csv(request.args.get("format"))
        if item in ANIME_FORMATS
    ]

    statuses = [
        item for item in parse_csv(request.args.get("status"))
        if item in ANIME_STATUSES
    ]

    season = request.args.get("season", "").strip().upper()
    season = season if season in ANIME_SEASONS else None

    year = parse_int(request.args.get("year"), None, 1940, 2200)
    rating = parse_float(request.args.get("rating"), None, 0, 10)

    sort = request.args.get("sort", "POPULARITY_DESC")

    if sort not in ALLOWED_ANIME_SORTS:
        sort = "POPULARITY_DESC"

    page = get_page()

    per_page = parse_int(
        request.args.get("per_page"),
        RESULTS_PER_PAGE,
        1,
        50
    ) or RESULTS_PER_PAGE

    # Only send filters that are actually set. AniList rejects null variables.
    variables = {
        "page": page,
        "perPage": per_page,
        "sort": [sort]
    }

    declarations = ["$page: Int", "$perPage: Int", "$sort: [MediaSort]"]
    arguments = ["type: ANIME", "sort: $sort"]

    def add_filter(name, graphql_type, value, argument=None):
        if value is None or value == [] or value == "":
            return

        variables[name] = value
        declarations.append(f"${name}: {graphql_type}")
        arguments.append(f"{argument or name}: ${name}")

    add_filter("genres", "[String]", genres, "genre_in")
    add_filter("tags", "[String]", tags, "tag_in")
    add_filter("formats", "[MediaFormat]", formats, "format_in")
    add_filter("statuses", "[MediaStatus]", statuses, "status_in")
    add_filter("season", "MediaSeason", season)
    add_filter("seasonYear", "Int", year, "seasonYear")

    if rating:
        add_filter("score", "Int", int(rating * 10), "averageScore_greater")

    query = (
        "query (" + ", ".join(declarations) + ") {\n"
        "  Page(page: $page, perPage: $perPage) {\n"
        "    pageInfo { currentPage hasNextPage lastPage perPage total }\n"
        "    media(" + ", ".join(arguments) + ") {\n"
        + ANIME_FIELDS +
        "    }\n"
        "  }\n"
        "}"
    )

    print("ANILIST DISCOVER VARIABLES:", variables)

    try:

        data = anilist_post(query, variables)

        page_data = data.get("Page", {})
        media_list = page_data.get("media", [])

        return jsonify({
            "results": [
                anilist_result(item)
                for item in media_list
            ],
            "pageInfo": page_data.get("pageInfo", {})
        })

    except (requests.RequestException, ValueError) as error:

        print("ANILIST DISCOVER ERROR:", error)

        return api_error(f"Could not discover anime: {error}", 502)

    except (KeyError, TypeError) as error:

        print("ANILIST DISCOVER PROCESSING ERROR:", error)

        return api_error("Could not process anime results.", 502)


# =====================================================
# ANIME DETAILS API
# =====================================================

@app.route("/api/anime/details/<int:anime_id>")
def anime_details(anime_id):

    query = """
    query ($id: Int) {

        Media(id: $id, type: ANIME) {

            id

            title {
                romaji
                english
                native
            }

            description

            coverImage {
                large
                extraLarge
            }

            bannerImage
            episodes
            duration
            averageScore
            meanScore
            format
            status
            genres

            tags {
                name
            }

            season
            seasonYear
            nextAiringEpisode { episode airingAt timeUntilAiring }

            startDate {
                year
                month
                day
            }

            studios {
                nodes {
                    name
                }
            }

            trailer {
                id
                site
            }
        }
    }
    """

    try:

        data = anilist_post(query, {"id": anime_id})
        media = data.get("Media")

        if not media:
            return api_error("Anime not found.", 404)

        return jsonify(media)

    except (requests.RequestException, ValueError) as error:

        print("ANILIST DETAILS ERROR:", error)

        return api_error(f"Could not load anime details: {error}", 502)


# =====================================================
# ANIME DETAILS PAGE
# =====================================================

@app.route("/anime/<int:anime_id>")
def anime_page(anime_id):

    return render_template(
        "anime.html",
        anime_id=anime_id
    )


# =====================================================
# ACTOR SEARCH
# =====================================================

@app.route("/api/actors/search")
def search_actors():

    query = request.args.get("q", "").strip()

    if not query:
        return jsonify({"results": []})

    try:

        data = tmdb_get(
            "/search/person",
            {
                "query": query,
                "include_adult": False
            }
        )

        results = []

        for person in data.get("results", []):

            results.append({
                "id": person.get("id"),
                "name": person.get("name"),
                "photo": image_url(person.get("profile_path")),

                "known_for": [
                    item.get("title") or item.get("name")
                    for item in person.get("known_for", [])
                ]
            })

        return jsonify({"results": results})

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB ACTOR SEARCH ERROR:", error)
        return api_error("Actor search failed.", 502)


# =====================================================
# ACTOR DETAILS PAGE
# =====================================================

@app.route("/actor/<int:actor_id>")
def actor_page(actor_id):

    return render_template(
        "actor.html",
        actor_id=actor_id
    )


# =====================================================
# ACTOR BASIC INFORMATION
# =====================================================

@app.route("/api/actors/<int:actor_id>")
def get_actor(actor_id):

    try:

        person = tmdb_get(f"/person/{actor_id}")

        return jsonify({
            "id": person.get("id"),
            "name": person.get("name"),
            "photo": image_url(person.get("profile_path"))
        })

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB ACTOR ERROR:", error)
        return api_error("Could not load actor information.", 502)


# =====================================================
# ACTOR MOVIE AND TV APPEARANCES
# =====================================================

@app.route("/api/actors/<int:actor_id>/credits")
def actor_credits(actor_id):

    try:

        data = tmdb_get(f"/person/{actor_id}/combined_credits")

        appearances = []

        for item in data.get("cast", []):

            media_type = item.get("media_type")

            if media_type not in ["movie", "tv"]:
                continue

            release_date = (
                item.get("release_date")
                or item.get("first_air_date")
                or ""
            )

            appearances.append({
                "id": item.get("id"),
                "title": item.get("title") or item.get("name"),
                "media_type": media_type,
                "character": item.get("character") or "Not available",
                "year": release_date[:4],
                "poster": image_url(item.get("poster_path")),
                "overview": item.get("overview") or "",
                "rating": item.get("vote_average"),
                "popularity": item.get("popularity", 0)
            })

        appearances.sort(
            key=lambda item: item["popularity"] or 0,
            reverse=True
        )

        return jsonify({"results": appearances})

    except ValueError as error:
        return api_error(str(error))

    except requests.RequestException as error:
        print("TMDB CREDITS ERROR:", error)
        return api_error("Could not load actor appearances.", 502)


# =====================================================
# HEALTH CHECK
# =====================================================

@app.route("/api/health")
def health_check():

    return jsonify({
        "status": "online",
        "application": "CineBot",
        "version": "3.0",
        "tmdb_configured": bool(TMDB_API_KEY),
        "pagination": True
    })


# =====================================================
# 404 ERROR PAGE
# =====================================================

@app.errorhandler(404)
def page_not_found(error):

    return render_template("404.html"), 404


# =====================================================
# 500 ERROR PAGE
# =====================================================

@app.errorhandler(500)
def internal_server_error(error):

    return jsonify({
        "error": "An internal server error occurred."
    }), 500


# =====================================================
# START FLASK APPLICATION
# =====================================================

if __name__ == "__main__":

    print("\n====================================")
    print("       CINEBOT 3.0 SERVER STARTED")
    print("====================================")
    print("Home:       http://127.0.0.1:5000")
    print("Anime:      http://127.0.0.1:5000/universe/anime")
    print("Movies:     http://127.0.0.1:5000/universe/movies")
    print("TV Shows:   http://127.0.0.1:5000/universe/tv")
    print("Discover:   http://127.0.0.1:5000/discover")
    print("Health:     http://127.0.0.1:5000/api/health")
    print("====================================\n")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )