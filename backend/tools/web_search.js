const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

module.exports = {
  name: "WEB_SEARCH",
  description: "Search the internet for the given query and return relevant results.",
  parametersSchema: {
    search_query: { type: "string", required: false },
    query: { type: "string", required: false }
  },
  async run(params, context) {
    try {
      const search_query = params.search_query || params.query;
      
      if (!search_query) {
        return { error: 'Missing search_query parameter.' };
      }
      
      // Log the search query
      console.log(`[WEB_SEARCH] Searching for: ${search_query}`);
      
      // Try multiple search engines in sequence with fallbacks
      let results = [];
      let currentMethod = 'primary';
      
      // Try DuckDuckGo first
      try {
        results = await searchDuckDuckGo(search_query);
        console.log(`[WEB_SEARCH] DuckDuckGo found ${results.length} results`);
      } catch (duckError) {
        console.error(`[WEB_SEARCH] DuckDuckGo error: ${duckError.message}`);
        currentMethod = 'fallback';
        
        // Try fallback search method
        try {
          results = await searchUsingFallback(search_query);
          console.log(`[WEB_SEARCH] Fallback search found ${results.length} results`);
        } catch (fallbackError) {
          console.error(`[WEB_SEARCH] Fallback search error: ${fallbackError.message}`);
          
          // If all search methods fail, return meaningful error
          return { 
            error: 'All search methods failed. This could be due to network issues or search rate limiting.',
            errorDetails: [duckError.message, fallbackError.message],
            results: []
          };
        }
      }
      
      // If no results from all methods, return empty results with message
      if (results.length === 0) {
        return {
          results: [],
          message: `No results found for query: ${search_query}. Try a different search term.`,
          searchMethod: currentMethod
        };
      }
      
      // Enhance results with source domain for better context
      results = results.map(result => {
        try {
          const urlObj = new URL(result.url);
          const domain = urlObj.hostname.replace('www.', '');
          return {
            ...result,
            domain
          };
        } catch (error) {
          return result;
        }
      });
      
      // Limit to top 5 results
      results = results.slice(0, 5);
      
      return { 
        results,
        query: search_query,
        resultCount: results.length,
        searchMethod: currentMethod
      };
    } catch (error) {
      console.error(`[WEB_SEARCH] Error: ${error.message}`);
      
      // Provide helpful error messages based on error type
      if (error.code === 'ENOTFOUND') {
        return { 
          error: 'Network error: Unable to connect to search service. Please check your internet connection.',
          results: []
        };
      }
      
      if (error.code === 'ETIMEDOUT' || error.code === 'ENETUNREACH' || error.message.includes('timeout')) {
        return {
          error: 'Search request timed out. The search service might be temporarily unavailable.',
          results: []
        };
      }
      
      return { 
        error: `Search failed: ${error.message}`,
        results: []
      };
    }
  }
};

// DuckDuckGo search function
async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, { 
    headers: { 
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml",
      "Accept-Language": "en-US,en;q=0.9"
    },
    timeout: 15000
  });
  
  const $ = cheerio.load(response.data);
  let results = [];
  
  // Check for CAPTCHA or robot detection
  const bodyText = $('body').text();
  if (bodyText.includes('robot') || bodyText.includes('captcha') || bodyText.includes('blocked')) {
    throw new Error("Search engine detected automated access");
  }
  
  // Enhanced result extraction with proper redirect parsing
  $(".result").each((i, el) => {
    const title = $(el).find("a.result__a").text().trim();
    const rawHref = $(el).find("a.result__a").attr("href");
    let url = rawHref;
    if (rawHref) {
      try {
        const parsedUrl = new URL(rawHref, 'https://html.duckduckgo.com');
        // If it's a DuckDuckGo redirect, extract 'uddg' or ad redirect 'u3'
        let target = null;
        if (parsedUrl.hostname.includes('duckduckgo.com')) {
          target = parsedUrl.searchParams.get('uddg') || parsedUrl.searchParams.get('u3');
        }
        if (target) {
          url = decodeURIComponent(target);
        } else if (!parsedUrl.hostname.includes('duckduckgo.com')) {
          url = parsedUrl.href;
        }
      } catch (err) {
        // Fallback regex for uddg or u3 params
        const regexMatch = rawHref.match(/[?&](?:uddg|u3)=([^&]+)/);
        url = regexMatch && regexMatch[1] ? decodeURIComponent(regexMatch[1]) : rawHref;
      }
      // Handle Bing ad redirects (e.g., bing.com/aclick?u=...)
      try {
        const tmp = new URL(url);
        if (tmp.hostname.includes('bing.com') && tmp.pathname.startsWith('/aclick')) {
          const real = tmp.searchParams.get('u');
          if (real) url = decodeURIComponent(real);
        }
      } catch (_) {}
    }
    
    // Extract snippet
    const snippet = $(el).find(".result__snippet").text().trim();
    
    if (title && url) {
      results.push({ title, url, snippet: snippet || "No description provided" });
    }
  });
  
  // Filter out any remaining DuckDuckGo or Bing redirect URLs
  results = results.filter(r => {
    try {
      const h = new URL(r.url).hostname;
      return !h.includes('duckduckgo.com') && !h.includes('bing.com');
    } catch {
      return true;
    }
  });
  
  // If no results from primary selector, try alternative selectors
  if (results.length === 0) {
    $(".web-result").each((i, el) => {
      const title = $(el).find("a.web-result__title").text().trim();
      let url = $(el).find("a.web-result__title").attr("href");
      const snippet = $(el).find(".web-result__snippet").text().trim();
      
      if (title && url) {
        results.push({ title, url, snippet: snippet || "No description provided" });
      }
    });
  }
  
  return results;
}

// Fallback search implementation
async function searchUsingFallback(query) {
  // This is a simple mock implementation that could be replaced with an actual
  // alternative search API like Bing, Google Custom Search, etc.
  console.log(`[FALLBACK_SEARCH] Attempting with query: ${query}`);
  
  // Mock response with generic information
  // In production, this should be replaced with a real API call
  const mockResults = [
    {
      title: `Information about ${query}`,
      url: `https://example.com/search?q=${encodeURIComponent(query)}`,
      snippet: `This is a fallback result about ${query}. In a production environment, this would connect to a real alternative search API.`
    }
  ];
  
  // Simulate network delay for testing
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return mockResults;
} 