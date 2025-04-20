const axios = require("axios");
const iconv = require("iconv-lite");
const cheerio = require("cheerio");

function isGitHubRepo(url) {
  // Matches https://github.com/user/repo or https://github.com/user/repo/
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url);
}

function isGitHubProfile(url) {
  // Matches https://github.com/user (with no additional path segments)
  return /^https?:\/\/github\.com\/[^/]+\/?$/.test(url) && !isGitHubRepo(url);
}

async function fetchGitHubProfileData(url) {
  try {
    const username = url.split('/').pop().replace(/\/$/, '');
    
    // Fetch basic user info
    const userResponse = await axios.get(`https://api.github.com/users/${username}`, {
      headers: { 'User-Agent': 'AI-Agent' }
    });
    
    // Fetch repositories
    const reposResponse = await axios.get(`https://api.github.com/users/${username}/repos?sort=updated&per_page=5`, {
      headers: { 'User-Agent': 'AI-Agent' }
    });
    
    // Build comprehensive profile data
    const profileData = {
      user: userResponse.data,
      repositories: reposResponse.data.map(repo => ({
        name: repo.name,
        description: repo.description || "No description provided",
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        updated_at: repo.updated_at,
        url: repo.html_url
      }))
    };
    
    // Format as readable text
    const formattedProfile = `
GitHub Profile: ${profileData.user.name || username} (${profileData.user.login})
${profileData.user.bio ? `Bio: ${profileData.user.bio}` : ''}
${profileData.user.location ? `Location: ${profileData.user.location}` : ''}
${profileData.user.company ? `Company: ${profileData.user.company}` : ''}
Public Repositories: ${profileData.user.public_repos}
Followers: ${profileData.user.followers}
Following: ${profileData.user.following}

Top Repositories:
${profileData.repositories.map(repo => 
  `- ${repo.name}: ${repo.description} 
   Language: ${repo.language || 'Not specified'}, Stars: ${repo.stars}, Forks: ${repo.forks}
   Updated: ${new Date(repo.updated_at).toLocaleDateString()}
   URL: ${repo.url}`
).join('\n\n')}
    `;
    
    return { 
      content: formattedProfile,
      raw: profileData,
      url: url
    };
  } catch (error) {
    console.error(`GitHub API error: ${error.message}`);
    // Fall back to HTML scraping if API fails
    return null;
  }
}

// PATCH: Try both README.md and README.MD in both main and master branches
async function fetchReadmeFromGitHub(url) {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  const user = match[1];
  const repo = match[2];
  const readmeNames = ["README.md", "README.MD"];
  const branches = ["main", "master"];
  
  // First try the API approach
  try {
    const response = await axios.get(`https://api.github.com/repos/${user}/${repo}/readme`, {
      headers: { 'User-Agent': 'AI-Agent', 'Accept': 'application/vnd.github.v3.raw' }
    });
    if (response.status === 200 && response.data) {
      return { content: response.data, url: url, source: 'api' };
    }
  } catch (e) {
    // Continue to fallback methods
  }
  
  // Fallback to raw content approach
  for (const branch of branches) {
    for (const name of readmeNames) {
      const readmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${name}`;
      try {
        const response = await axios.get(readmeUrl);
        if (response.status === 200 && response.data) {
          return { content: response.data, url: readmeUrl };
        }
      } catch (e) {
        // Try next
      }
    }
  }
  return null;
}

// Extract main content from HTML using a more robust approach
function extractMainContent(html) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script, style, iframe, nav, footer, header, .header, .footer, .nav, .sidebar').remove();
  
  // Try to find main content container
  const mainSelectors = [
    'main', 
    '[role="main"]', 
    '#content', 
    '.content', 
    'article', 
    '.article', 
    '.post-content',
    '.main',
    '#main'
  ];
  
  let mainContent = '';
  
  // Try each selector until we find content
  for (const selector of mainSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      mainContent = element.text().trim();
      break;
    }
  }
  
  // If no main content found, extract from body with headings
  if (!mainContent || mainContent.length < 100) {
    let bodyText = '';
    
    // Get the title
    const title = $('title').first().text().trim();
    if (title) bodyText += `Title: ${title}\n\n`;
    
    // Get meta description
    const description = $('meta[name="description"]').attr('content');
    if (description) bodyText += `Description: ${description}\n\n`;
    
    // Extract headings and associated content
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      const headingText = $(el).text().trim();
      if (headingText) {
        bodyText += `${headingText}\n`;
        
        // Get next elements until next heading
        let next = $(el).next();
        while (next.length > 0 && !next.is('h1, h2, h3, h4, h5, h6')) {
          if (next.is('p, li, div')) {
            const text = next.text().trim();
            if (text) bodyText += `${text}\n`;
          }
          next = next.next();
        }
        bodyText += '\n';
      }
    });
    
    // If we still don't have much content, fall back to all paragraphs
    if (bodyText.length < 100) {
      bodyText = '';
      $('p, li').each((i, el) => {
        const text = $(el).text().trim();
        if (text) bodyText += `${text}\n\n`;
      });
    }
    
    mainContent = bodyText.trim();
  }
  
  return mainContent;
}

module.exports = {
  name: "READ_URL",
  description: "Retrieve content from a URL and return its title and main body text. For GitHub repos, attempts to fetch README.md.",
  meta: {
    supports: ["HTML", "Markdown", "GitHub"],
    notes: "Enhanced with GitHub API integration and robust content extraction"
  },
  parametersSchema: {
    url: { type: "string", required: true }
  },
  async run({ url }, context) {
    try {
      // Handle GitHub profile pages
      if (isGitHubProfile(url)) {
        const profileData = await fetchGitHubProfileData(url);
        if (profileData) {
          return {
            result: profileData.content,
            error: null,
            meta: { 
              contentType: "github-profile", 
              sourceUrl: url, 
              notes: "Fetched GitHub profile data using GitHub API",
              raw: profileData.raw
            }
          };
        }
      }
      
      // Handle GitHub repos
      if (isGitHubRepo(url)) {
        const readme = await fetchReadmeFromGitHub(url);
        if (readme) {
          return {
            result: readme.content,
            error: null,
            meta: { 
              contentType: "markdown", 
              sourceUrl: readme.url, 
              notes: `Fetched README.md from GitHub repo using ${readme.source || 'raw content'}.` 
            }
          };
        }
      }
      
      // Fallback: fetch and parse as HTML
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Agent/1.0)' },
        timeout: 10000
      });
      
      let charset = 'utf-8';
      const contentType = response.headers['content-type'];
      if (contentType) {
        const matches = contentType.match(/charset=([^;]+)/);
        if (matches && matches[1]) {
          charset = matches[1].trim();
        }
      }
      const decodedData = iconv.decode(response.data, charset);
      const $ = cheerio.load(decodedData);
      const title = $('title').first().text().trim();
      
      // Extract main content from raw HTML
      const bodyText = extractMainContent(decodedData);
      
      // PATCH: Limit bodyText to first 3000 characters
      const truncatedBody = bodyText.length > 3000 
        ? bodyText.slice(0, 3000) + "... [truncated]"
        : bodyText;
      
      return {
        result: { title, bodyText: truncatedBody },
        error: null,
        meta: { contentType: "html", sourceUrl: url, notes: "Fetched and parsed HTML content using enhanced extraction." }
      };
    } catch (error) {
      // PATCH: Map common network errors to user-friendly messages
      let userMessage = error.message;
      if (userMessage.includes('ENOTFOUND') || userMessage.includes('getaddrinfo')) {
        userMessage = 'Could not resolve the domain name.';
      } else if (userMessage.includes('timeout')) {
        userMessage = 'The request timed out. Please try again later.';
      } else if (userMessage.includes('404')) {
        userMessage = 'The requested page or file was not found (404).';
      } else if (userMessage.includes('429')) {
        userMessage = 'Rate limit exceeded. The website is limiting our requests (429).';
      }
      return {
        result: null,
        error: userMessage,
        meta: { sourceUrl: url, notes: "Failed to fetch or parse content." }
      };
    }
  }
}; 