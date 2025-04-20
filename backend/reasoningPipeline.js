const genAI = require('./aiClient');
const memoryManager = require('./memory/memory_manager');
const toolSelector = require('./toolSelector');
const toolExecutor = require('./toolExecutor');
const resultChecker = require('./resultChecker');
const newQueryGenerator = require('./newQueryGenerator');
const logger = require('./logger');
const { runCoT } = require('./coTHelper');
const { detectMessageIntent } = require('./tools/respond');

/**
 * Runs the full reasoning pipeline for a user query.
 * Returns finalResponse and a log of reasoning steps.
 */
module.exports = async function runPipeline(userMsg, history = [], onProgress) {
  const reasoningLog = [];
  const toolHistory = { web_searches: [], url_reads: [] };
  let finalResponse = '';
  let satisfied = false;
  let iteration = 0;
  const maxIterations = 5;

  // Helper to record and stream a log entry
  function log(entry) {
    const withTs = { timestamp: new Date().toISOString(), ...entry };
    reasoningLog.push(withTs);
    // Output debug log for each step
    try { logger.debug(`[Pipeline] ${withTs.step}: ${withTs.message}`); } catch(e) {}
    // Stream to client if callback provided (old style)
    if (typeof onProgress === 'function') {
      try { onProgress(withTs); } catch(e){}
    }
  }

  // 1) Retrieve facts from memory
  const facts = await memoryManager.getAllFacts();
  // Add current date fact
  facts.push({ type: 'current_date', value: new Date().toLocaleDateString() });
  log({ step: '1. Retrieved Chat Facts', message: JSON.stringify(facts) });

  // Log conversation history passed from client
  if (Array.isArray(history) && history.length) {
    log({ step: '2. Added Conversation History', message: JSON.stringify(history) });
  }

  // 2b) Chain-of-Thought Intent Classification
  log({ step: '2b. Intent Classification – CoT Start', message: '' });
  const intentSchema = '{"reasoning":[],"intent":""}';
  const intentSteps = [
    'Read the user message',
    'Decide if the intent is one of greeting, farewell, thanks, age_query, birthyear_query, date_query, search_query, followup or other',
    'Return the chosen intent in the "intent" field'
  ];
  const intentCoT = await runCoT(userMsg, facts, intentSteps, intentSchema);
  log({ step: '2b. Intent Classification', message: JSON.stringify(intentCoT.reasoning) });
  let userIntent = intentCoT.intent;

  // Branch on classified intent
  if (["greeting","farewell","thanks"].includes(userIntent)) {
    const resp = await toolExecutor('RESPOND', {}, { userMsg });
    finalResponse = resp.reply;
    log({ step: '2b1. Simple Intent Response', message: finalResponse });
    return { finalResponse, reasoningLog };
  }
  if (userIntent === 'age_query') {
    log({ step: '2b2. Age Intent Reasoning – CoT Start', message: '' });
    const ageSchema = '{"reasoning":[],"age":0}';
    const ageSteps = [
      'Retrieve birthYear from memory facts',
      'Compute current year minus birthYear'
    ];
    const ageCoT = await runCoT(userMsg, facts, ageSteps, ageSchema);
    log({ step: '2b2. Age Intent Reasoning', message: JSON.stringify(ageCoT.reasoning) });
    finalResponse = `${ageCoT.age}`;
    log({ step: '2b2. Age Response', message: finalResponse });
    return { finalResponse, reasoningLog };
  }
  if (userIntent === 'birthyear_query') {
    log({ step: '2b3. BirthYear Intent Reasoning – CoT Start', message: '' });
    const bySchema = '{"reasoning":[],"birthYear":""}';
    const bySteps = [
      'Retrieve birthYear fact from memory'
    ];
    const byCoT = await runCoT(userMsg, facts, bySteps, bySchema);
    log({ step: '2b3. BirthYear Intent Reasoning', message: JSON.stringify(byCoT.reasoning) });
    finalResponse = byCoT.birthYear;
    log({ step: '2b3. BirthYear Response', message: finalResponse });
    return { finalResponse, reasoningLog };
  }
  if (userIntent === 'date_query') {
    const dateRes = await toolExecutor('GET_DATE', {}, { userMsg });
    finalResponse = dateRes.reply;
    log({ step: '2b4. Date Response', message: finalResponse });
    return { finalResponse, reasoningLog };
  }

  // 2a) Chain-of-Thought for follow-up detection
  if (Array.isArray(history) && history.length) {
    const lastAgent = [...history].reverse().find(h => h.role === 'agent');
    if (lastAgent && lastAgent.text) {
      const fuSchema = '{"reasoning":[],"isFollowUp":false}';
      const fuSteps = [
        'Summarize the last agent reply',
        'Compare it with the new user message',
        'Decide if the user is requesting an expansion of the previous reply'
      ];
      const fuFacts = [{ type: 'lastAgent', value: lastAgent.text }];
      const fuCoT = await runCoT(userMsg, fuFacts, fuSteps, fuSchema);
      log({ step: '3. Follow-Up Detection CoT', message: JSON.stringify(fuCoT.reasoning) });
      if (fuCoT.isFollowUp) {
        // Expand the last reply via CoT
        const expSchema = '{"reasoning":[],"expanded":""}';
        const expSteps = [
          'Re-read the last agent reply',
          'Provide a more detailed, expanded version'
        ];
        const expFacts = [{ type: 'lastAgent', value: lastAgent.text }];
        const expCoT = await runCoT('', expFacts, expSteps, expSchema);
        log({ step: 'Final Response', message: expCoT.expanded });
        return { finalResponse: expCoT.expanded, reasoningLog };
      }
    }
  }

  // 2) Memory-only attempt with explicit Chain-of-Thought
  const memoSchema = '{"reasoning":[],"found":false,"answer":""}';
  const memoSteps = [
    'List all stored facts',
    'Decide if any fact directly answers the query',
    'If yes, state the answer'
  ];
  const memCoT = await runCoT(userMsg, facts, memoSteps, memoSchema);
  log({ step: '9. Checked Chat Memory (CoT)', message: JSON.stringify(memCoT.reasoning) });
  if (memCoT.found) {
    log({ step: '9b. Memory Answer', message: memCoT.answer });
    return { finalResponse: memCoT.answer, reasoningLog };
  }

  // 3) Iterative tool loop
  while (!satisfied && iteration < maxIterations) {
    // 3a) Chain-of-Thought for tool selection
    log({ step: '10. Choosing Next Tool – CoT Start', message: '' });
    const tsSchema = '{"reasoning":[],"tool":"","params":{}}';
    const tsSteps = [
      'Review user message and conversation context',
      'Weigh against available tools (WEB_SEARCH, READ_URL, GET_DATE, RESPOND)',
      'Decide which tool best fits'
    ];
    const tsCoT = await runCoT(userMsg, facts, tsSteps, tsSchema);
    log({ step: '10a. Tool Selection Reasoning', message: JSON.stringify(tsCoT.reasoning) });
    // 10b. Decide tool based on CoT suggestion or fallback
    log({ step: '10b. CoT Suggests Tool', message: `${tsCoT.tool}` });
    // If input looks like an identifier (e.g., username with digits), force a web search
    const isIdentifierSearch = /^[A-Za-z0-9_-]+$/.test(userMsg) && /\d/.test(userMsg);
    let decision;
    if (isIdentifierSearch) {
      decision = { tool: 'WEB_SEARCH', params: { query: userMsg } };
      log({ step: '10b1. Forced WEB_SEARCH', message: userMsg });
    } else if (tsCoT.tool && ['WEB_SEARCH','READ_URL','GET_DATE'].includes(tsCoT.tool)) {
      // Honor CoT suggestion if it's a search or read operation, not a generic RESPOND
      decision = { tool: tsCoT.tool, params: tsCoT.params };
    } else {
      // Otherwise fallback to the standard selector
      decision = await toolSelector(userMsg, facts, toolHistory, history);
    }
    log({ step: '11. Selected Tool', message: JSON.stringify(decision) });

    // Avoid repeating searches
    if (decision.tool === 'WEB_SEARCH' && toolHistory.web_searches.includes(decision.params.query)) {
      const newQuery = await newQueryGenerator(userMsg, toolHistory, reasoningLog, iteration + 1);
      decision = { tool: 'WEB_SEARCH', params: { query: newQuery } };
      log({ step: '12. Refined Search Query', message: newQuery });
    }

    // Execute the tool
    const result = await toolExecutor(decision.tool, decision.params, { userMsg, toolHistory, reasoningLog });
    log({ step: '13. Received Tool Execution Result', message: JSON.stringify(result).slice(0, 300) });
    // Debug: log how many results were returned for web searches
    if (decision.tool === 'WEB_SEARCH') {
      const count = result.resultCount ?? (Array.isArray(result.results) ? result.results.length : 0);
      log({ step: '13a. Web Search Result Count', message: `Found ${count} results for query "${decision.params.query}"` });
      // Debug: list each URL returned by the search
      if (Array.isArray(result.results) && result.results.length > 0) {
        const urlsList = result.results.map((r, idx) => `${idx+1}. ${r.url}`).join('\n');
        log({ step: '13b. Web Search URLs', message: urlsList });
      }
    }

    // After listing URLs, use CoT to select and run tools to read and summarize each URL
    if (decision.tool === 'WEB_SEARCH' && Array.isArray(result.results)) {
      for (const r of result.results) {
        const url = r.url;
        // 13c. URL Tool Selection CoT Start
        log({ step: '13c. URL Tool Selection CoT Start', message: url });
        const urlTsSchema = '{"reasoning":[],"tool":"","params":{}}';
        const urlTsSteps = [
          'Review the URL and decide which tool to use to retrieve or process it'
        ];
        const urlTsCoT = await runCoT(url, facts, urlTsSteps, urlTsSchema);
        log({ step: '13c. URL Tool Selection CoT', message: JSON.stringify(urlTsCoT.reasoning) });
        // Determine tool decision for URL (force READ_URL if unclear)
        let urlDecision = { tool: urlTsCoT.tool, params: urlTsCoT.params };
        if (urlDecision.tool !== 'READ_URL') {
          urlDecision = { tool: 'READ_URL', params: { url } };
          log({ step: '13c1. Forced URL Read Decision', message: JSON.stringify(urlDecision) });
        }
        // Execute URL read
        const readRes = await toolExecutor(urlDecision.tool, urlDecision.params, { userMsg, toolHistory, reasoningLog });
        log({ step: '13d. URL Read Result', message: JSON.stringify(readRes).slice(0, 300) });
        // 13e. Summarize URL content relative to user query
        const contentText = (readRes.result && readRes.result.bodyText) || readRes.result || '';
        const summaryPrompt = `Summarize the content from ${url} in context of the query "${userMsg}":\n\n${contentText}`;
        const summaryModel = genAI.getGenerativeModel({ model: "gemma-3-27b-it" });
        const summaryRes = await summaryModel.generateContent(summaryPrompt);
        const summaryText = await summaryRes.response.text();
        log({ step: '13e. URL Summary', message: summaryText.slice(0, 300) });
      }
    }

    // Bypass CoT for any direct reply from non-search tools
    if (result.reply && decision.tool !== 'WEB_SEARCH') {
      finalResponse = result.reply;
      log({ step: '17. Final Response Sent', message: finalResponse });
      satisfied = true;
      break;
    }

    // If we performed a web search, automatically fetch and summarize top hits
    if (decision.tool === 'WEB_SEARCH' && Array.isArray(result.results) && result.results.length > 0) {
      // Retrieve and validate content for the top 3 search hits
      const validHits = result.results.slice(0, 3).filter(hit => /^https?:\/\//i.test(hit.url));
      const sources = [];
      for (const hit of validHits) {
        let content = '';
        try {
          const readRes = await toolExecutor('READ_URL', { url: hit.url }, { userMsg, toolHistory, reasoningLog });
          if (readRes.error) {
            log({ step: 'READ_URL Error', message: `Failed to fetch ${hit.url}: ${readRes.error}` });
          } else {
            // Prefer parsed bodyText, else raw result
            content = (readRes.result && readRes.result.bodyText) || readRes.result || '';
          }
        } catch (e) {
          log({ step: 'READ_URL Exception', message: `Exception fetching ${hit.url}: ${e.message}` });
        }
        sources.push({ title: hit.title, url: hit.url, snippet: hit.snippet, content });
      }
      // Summarize the collected sources
      const summaryPrompt = `Summarize these web results for the query "${userMsg}":\n${sources.map(s => `Title: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}\nContent: ${s.content}`).join("\n\n")}`;
      const summaryModel = genAI.getGenerativeModel({ model: "gemma-3-27b-it" });
      const summaryRes = await summaryModel.generateContent(summaryPrompt);
      const summaryText = await summaryRes.response.text();
      log({ step: '14. Generated Summary from Results', message: summaryText });
      // Verify if the summary satisfies the user's query
      const summaryCheck = await resultChecker({ reply: summaryText }, userMsg, reasoningLog, iteration+1);
      log({ step: '15. Validated Summary Quality', message: JSON.stringify(summaryCheck) });
      if (summaryCheck.sufficient) {
        // Try to extract and store birth year from summary for future age queries
        const birthMatch = summaryText.match(/\b(?:19|20)\d{2}\b/);
        if (birthMatch) {
          const year = birthMatch[0];
          // store as session memory
          await memoryManager.storeFact({ type: 'birthYear', value: year }, 'session');
          log({ step: 'Stored Fact: birthYear', message: year });
        }
        finalResponse = summaryText;
        log({ step: '17. Final Response Sent', message: finalResponse });
        satisfied = true;
        break;
      } else {
        // If not sufficient, continue to next iteration
        iteration++;
        continue;
      }
    }

    // Record tool usage
    if (decision.tool === 'WEB_SEARCH') toolHistory.web_searches.push(decision.params.query);
    if (decision.tool === 'READ_URL') toolHistory.url_reads.push(decision.params.url);

    // 3c) Chain-of-Thought for result validation
    log({ step: '16. Result Validation – CoT Start', message: '' });
    const rvSchema = '{"reasoning":[],"sufficient":false,"answer":""}';
    const rvSteps = [
      'Summarize the tool output',
      'Compare summary against user query',
      'Decide if it fully answers the user'
    ];
    const outputToValidate = result.reply || result.result || JSON.stringify(result);
    const rvCoT = await runCoT(outputToValidate, [], rvSteps, rvSchema);
    log({ step: '16a. Validation Reasoning', message: JSON.stringify(rvCoT.reasoning) });
    if (rvCoT.sufficient) {
      finalResponse = rvCoT.answer;
      log({ step: '17. Final Response Sent', message: finalResponse });
      satisfied = true;
    } else {
      // Skip user confirmation; continue to next tool attempt
      log({ step: 'Retry Without Confirmation', message: 'Result insufficient, trying next tool or search' });
      iteration++;
    }
  }

  if (!satisfied) {
    finalResponse = "Sorry, I couldn't satisfy your request.";
    log({ step: 'Final Response', message: finalResponse });
  }

  return { finalResponse, reasoningLog };
}; 