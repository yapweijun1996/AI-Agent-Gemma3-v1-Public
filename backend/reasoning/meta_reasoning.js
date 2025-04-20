/* backend/reasoning/meta_reasoning.js */
const { createLogger, format, transports } = require('winston');
const logger = require('../logger');

// Task state constants
const TASK_STATES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

/**
 * Manages the reasoning state for complex queries
 * Tracks progress, handles failures, and suggests alternatives
 */
class ReasoningStateManager {
  constructor() {
    this.tasks = new Map();
    this.results = new Map();
    this.approaches = new Map();
    this.checkpoints = [];
  }
  
  initializePlan(plan) {
    plan.steps.forEach((step, index) => {
      const taskId = step.id || `task-${index}`;
      this.tasks.set(taskId, {
        ...step,
        id: taskId,
        state: TASK_STATES.PENDING,
        startTime: null,
        endTime: null
      });
    });
    
    // Create initial checkpoint
    this.createCheckpoint('plan_initialized');
  }
  
  updateTaskState(taskId, newState) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    const updatedTask = {
      ...task,
      state: newState,
      lastUpdated: Date.now()
    };
    
    // Set start/end times based on state transitions
    if (newState === TASK_STATES.IN_PROGRESS && !task.startTime) {
      updatedTask.startTime = Date.now();
    }
    
    if ([TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.SKIPPED].includes(newState) 
        && !task.endTime) {
      updatedTask.endTime = Date.now();
    }
    
    this.tasks.set(taskId, updatedTask);
    return true;
  }
  
  recordSuccess(taskId, result) {
    this.updateTaskState(taskId, TASK_STATES.COMPLETED);
    this.results.set(taskId, result);
    this.createCheckpoint(`task_${taskId}_completed`);
    return true;
  }
  
  recordFailure(taskId, approach, error) {
    this.updateTaskState(taskId, TASK_STATES.FAILED);
    
    if (!this.approaches.has(taskId)) {
      this.approaches.set(taskId, []);
    }
    
    this.approaches.get(taskId).push({
      approach,
      error: error.message || error,
      timestamp: Date.now()
    });
    
    this.createCheckpoint(`task_${taskId}_failed`);
    return true;
  }
  
  suggestAlternativeApproach(taskId, context) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const failedApproaches = this.approaches.get(taskId) || [];
    
    if (failedApproaches.length === 0) {
      return { approach: 'default', confidence: 1.0 };
    }
    
    // Get list of approaches already tried
    const triedApproaches = failedApproaches.map(a => a.approach);
    
    // Check if we've tried too many approaches
    if (triedApproaches.length >= 3) {
      return {
        approach: 'DIRECT_RESPONSE',
        confidence: 0.6,
        responseType: 'summary',
        previousApproaches: triedApproaches
      };
    }
    
    // Check error patterns
    const errorPatterns = failedApproaches.map(a => a.error || '');
    
    // Handle URL errors specifically
    if (errorPatterns.some(e => e.includes('Invalid URL') || e.includes('undefined'))) {
      return {
        approach: 'SINGLE_URL_PROCESSING',
        confidence: 0.8,
        previousApproaches: triedApproaches
      };
    }
    
    // Handle parameter mismatches
    if (errorPatterns.some(e => e.includes('Missing required parameter') || e.includes('parameter'))) {
      // If the error is related to REASONING_TOOL's 'problem' parameter
      if (errorPatterns.some(e => e.includes('problem'))) {
        return {
          approach: 'WEB_SEARCH',  // Fallback to web search
          confidence: 0.7,
          previousApproaches: triedApproaches
        };
      }
    }
    
    // Enhanced task-specific alternatives
    switch (task.type) {
      case "INFORMATION_GATHERING": 
        return this.suggestAlternativeInfoGathering(triedApproaches, context);
        
      case "SYNTHESIS":
        // If synthesis fails, try direct approach
        if (!triedApproaches.includes('DIRECT_SYNTHESIS')) {
          return {
            approach: 'DIRECT_SYNTHESIS',
            confidence: 0.8,
            previousApproaches: triedApproaches
          };
        }
        break;
        
      case "TOOL_SELECTION":
        return this.suggestAlternativeTool(triedApproaches, context);
    }
    
    // Default to asking user
    return {
      approach: 'ASK_CLARIFICATION',
      confidence: 0.5,
      previousApproaches: triedApproaches
    };
  }
  
  suggestAlternativeInfoGathering(triedApproaches, context) {
    // Tool priority order for information gathering
    const toolPriorities = [
      { tool: 'WEB_SEARCH', confidence: 0.9 },
      { tool: 'READ_URL', confidence: 0.8 },
      { tool: 'MEMORY_CHECK', confidence: 0.7 },
      { tool: 'REASONING_TOOL', confidence: 0.6 }
    ];
    
    // Find first tool that hasn't been tried
    for (const toolOption of toolPriorities) {
      if (!triedApproaches.includes(toolOption.tool)) {
        return {
          approach: toolOption.tool,
          confidence: toolOption.confidence,
          previousApproaches: triedApproaches
        };
      }
    }
    
    // If all tools were tried, try direct synthesis
    if (!triedApproaches.includes('DIRECT_SYNTHESIS')) {
      return {
        approach: 'DIRECT_SYNTHESIS',
        confidence: 0.7,
        previousApproaches: triedApproaches
      };
    }
    
    // If all approaches were tried, suggest clarification
    return {
      approach: 'ASK_CLARIFICATION',
      confidence: 0.5,
      previousApproaches: triedApproaches
    };
  }
  
  suggestAlternativeTool(triedApproaches, context) {
    // Generate contextual alternatives based on the user query
    const query = context?.userMsg || '';
    
    // If query contains GitHub, suggest code search alternatives
    if (query.toLowerCase().includes('github') && !triedApproaches.includes('READ_URL')) {
      return {
        approach: 'READ_URL',
        confidence: 0.8,
        previousApproaches: triedApproaches
      };
    }
    
    // If query seems factual and web search was tried, suggest reasoning
    if (!triedApproaches.includes('REASONING_TOOL') && 
        triedApproaches.includes('WEB_SEARCH')) {
      return {
        approach: 'REASONING_TOOL',
        confidence: 0.7,
        previousApproaches: triedApproaches
      };
    }
    
    // Default to asking user
    return {
      approach: 'ASK_CLARIFICATION',
      confidence: 0.5,
      previousApproaches: triedApproaches
    };
  }
  
  createCheckpoint(name) {
    this.checkpoints.push({
      name,
      timestamp: Date.now(),
      taskStates: new Map([...this.tasks].map(([id, task]) => [id, task.state])),
      resultsSnapshot: new Map(this.results),
      approachesSnapshot: new Map(this.approaches)
    });
    
    // Keep only the last 10 checkpoints
    if (this.checkpoints.length > 10) {
      this.checkpoints.shift();
    }
  }
  
  restoreCheckpoint(name) {
    const checkpoint = this.checkpoints.find(cp => cp.name === name);
    if (!checkpoint) return false;
    
    // Restore state from checkpoint
    this.tasks = new Map([...checkpoint.taskStates]);
    this.results = new Map([...checkpoint.resultsSnapshot]);
    this.approaches = new Map([...checkpoint.approachesSnapshot]);
    
    return true;
  }
  
  getTaskStatus() {
    const status = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      total: this.tasks.size
    };
    
    this.tasks.forEach(task => {
      switch (task.state) {
        case TASK_STATES.PENDING: status.pending++; break;
        case TASK_STATES.IN_PROGRESS: status.inProgress++; break;
        case TASK_STATES.COMPLETED: status.completed++; break;
        case TASK_STATES.FAILED: status.failed++; break;
        case TASK_STATES.SKIPPED: status.skipped++; break;
      }
    });
    
    return status;
  }
}

/**
 * Decomposes a complex query into subtasks
 * @param {string} query - The user's query
 * @param {object} context - Context including facts and history
 * @param {object} modelProvider - LLM provider
 * @returns {Array} Decomposed tasks with dependencies
 */
async function decomposeQuery(query, context, modelProvider) {
  try {
    logger.info(`Decomposing query: "${query}"`);
    
    const model = modelProvider.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
You are an expert in breaking down complex problems into smaller, manageable tasks.
Analyze this query and decompose it into a logical sequence of sub-tasks.

USER QUERY: "${query}"

${context.facts?.length ? `KNOWN FACTS:
${context.facts.map(f => `- ${f.type}: ${f.value}`).join('\n')}` : ''}

CONTEXT: ${context.historyContext || 'No additional context'}

Break down this query into 3-6 subtasks that would help solve it effectively.
For each subtask, specify:
1. A unique ID (task-1, task-2, etc.)
2. Task type (one of: MEMORY_CHECK, INTENT_CLASSIFICATION, TOOL_SELECTION, INFORMATION_GATHERING, SYNTHESIS, VERIFICATION)
3. A specific description of what this subtask should accomplish
4. Input requirements - what information this task needs
5. Output expectations - what information this task should produce
6. Dependencies - IDs of tasks that must be completed before this one (if any)
7. Priority (1-5, where 1 is highest priority)

IMPORTANT: Please ensure tasks are in a logical order. For example:
- MEMORY_CHECK and INTENT_CLASSIFICATION should come before TOOL_SELECTION
- TOOL_SELECTION should come before INFORMATION_GATHERING
- INFORMATION_GATHERING should come before SYNTHESIS
- SYNTHESIS should come before VERIFICATION

Return your analysis as a JSON array:
[
  {
    "id": "task-1",
    "type": "INTENT_CLASSIFICATION",
    "description": "Determine if user is asking about personal GitHub repos or general GitHub usage",
    "input": "User query",
    "output": "Classification of intent as personal or general question",
    "dependencies": [],
    "priority": 1
  },
  // more tasks...
]
`;

    const result = await model.generateContent(prompt);
    const text = await result.response.text();
    
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("Failed to extract tasks JSON from LLM response");
      return getDefaultTasks(query);
    }
    
    const tasks = JSON.parse(jsonMatch[0]);
    
    // Validate task structure
    const validatedTasks = tasks.map(task => ({
      id: task.id || `task-${Math.random().toString(36).substring(2, 8)}`,
      type: task.type || 'GENERIC',
      description: task.description || 'Execute task',
      input: task.input || 'Query',
      output: task.output || 'Result',
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      priority: task.priority || 3,
      optional: !!task.optional
    }));
    
    // Apply logical dependency enforcement
    const tasksWithLogicalDeps = enforceLogicalDependencies(validatedTasks);
    
    logger.info(`Query decomposed into ${tasksWithLogicalDeps.length} subtasks`);
    return sortTasksByDependencies(tasksWithLogicalDeps);
    
  } catch (error) {
    logger.error(`Error decomposing query: ${error.message}`);
    return getDefaultTasks(query);
  }
}

/**
 * Enforce logical dependencies between different task types
 * @param {Array} tasks - The tasks to enforce dependencies on
 * @returns {Array} Tasks with enforced logical dependencies
 */
function enforceLogicalDependencies(tasks) {
  // Create a map of tasks by ID and type
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const tasksByType = {};
  
  tasks.forEach(task => {
    if (!tasksByType[task.type]) {
      tasksByType[task.type] = [];
    }
    tasksByType[task.type].push(task);
  });
  
  // Define logical dependencies between task types
  const logicalOrder = {
    "MEMORY_CHECK": [],
    "INTENT_CLASSIFICATION": [],
    "TOOL_SELECTION": ["INTENT_CLASSIFICATION", "MEMORY_CHECK"],
    "INFORMATION_GATHERING": ["TOOL_SELECTION"],
    "SYNTHESIS": ["INFORMATION_GATHERING"],
    "VERIFICATION": ["SYNTHESIS"]
  };
  
  // Enforce logical dependencies
  return tasks.map(task => {
    const requiredDependencyTypes = logicalOrder[task.type] || [];
    const newDependencies = [...task.dependencies];
    
    // Add logical dependencies if they're not already included
    requiredDependencyTypes.forEach(depType => {
      // Skip if this type doesn't exist in our tasks
      if (!tasksByType[depType] || tasksByType[depType].length === 0) {
        return;
      }
      
      // Check if we already depend on a task of this type
      const alreadyHasDep = task.dependencies.some(depId => {
        const depTask = taskMap.get(depId);
        return depTask && depTask.type === depType;
      });
      
      // If not, add the highest priority task of this type as a dependency
      if (!alreadyHasDep) {
        const highestPriorityTask = tasksByType[depType]
          .sort((a, b) => a.priority - b.priority)[0];
        
        newDependencies.push(highestPriorityTask.id);
      }
    });
    
    return {
      ...task,
      dependencies: newDependencies
    };
  });
}

/**
 * Sorts tasks based on dependencies and priorities
 * @param {Array} tasks - Unsorted tasks
 * @returns {Array} Tasks sorted by execution order
 */
function sortTasksByDependencies(tasks) {
  // Create a map of task IDs to their indices
  const taskMap = new Map(tasks.map((task, index) => [task.id, index]));
  
  // Create a dependency graph
  const graph = new Map();
  tasks.forEach(task => {
    graph.set(task.id, task.dependencies);
  });
  
  // Topologically sort tasks
  const visited = new Set();
  const temp = new Set();
  const result = [];
  
  function visit(taskId) {
    if (temp.has(taskId)) {
      // Cyclic dependency detected, break cycle
      logger.warn(`Cyclic dependency detected for task ${taskId}`);
      return;
    }
    
    if (visited.has(taskId)) return;
    
    temp.add(taskId);
    
    const dependencies = graph.get(taskId) || [];
    for (const depId of dependencies) {
      if (taskMap.has(depId)) {
        visit(depId);
      }
    }
    
    temp.delete(taskId);
    visited.add(taskId);
    result.push(taskId);
  }
  
  // Visit all nodes
  tasks.forEach(task => {
    if (!visited.has(task.id)) {
      visit(task.id);
    }
  });
  
  // Reverse the result and map back to tasks
  return result.reverse().map(id => tasks[taskMap.get(id)]);
}

/**
 * Generate default reasoning tasks for a query
 * @param {string} query - The user query 
 * @returns {Array} Default tasks
 */
function getDefaultTasks(query) {
  return [
    {
      id: "task-1",
      type: "MEMORY_CHECK",
      description: "Check if query can be answered from memory",
      input: "User query",
      output: "Memory check result",
      dependencies: [],
      priority: 1
    },
    {
      id: "task-2", 
      type: "INTENT_CLASSIFICATION",
      description: "Classify user intent",
      input: "User query",
      output: "Intent classification",
      dependencies: [],
      priority: 1
    },
    {
      id: "task-3",
      type: "TOOL_SELECTION",
      description: "Select appropriate tool based on intent",
      input: "Intent classification",
      output: "Selected tool",
      dependencies: ["task-2"],
      priority: 2
    },
    {
      id: "task-4",
      type: "INFORMATION_GATHERING",
      description: "Gather information using selected tool",
      input: "Selected tool",
      output: "Retrieved information",
      dependencies: ["task-3"],
      priority: 3
    },
    {
      id: "task-5",
      type: "SYNTHESIS",
      description: "Synthesize answer from gathered information",
      input: "Retrieved information",
      output: "Final answer",
      dependencies: ["task-4"],
      priority: 4
    }
  ];
}

/**
 * Plans the execution steps needed to answer a user query
 * @param {string} userQuery - The user's question or request
 * @param {Array} facts - Known facts about the user
 * @param {string} historyContext - Conversation history
 * @returns {Object} A plan with steps to execute
 */
async function planQueryExecution(userQuery, facts, historyContext, modelProvider) {
  try {
    logger.info(`Planning execution for query: "${userQuery}"`);
    
    // Use enhanced decomposition for complex queries
    const context = { facts, historyContext };
    const decomposedTasks = await decomposeQuery(userQuery, context, modelProvider);
    
    // Create the reasoning state manager
    const stateManager = new ReasoningStateManager();
    
    // Convert decomposed tasks to plan steps
    const steps = decomposedTasks.map(task => ({
      id: task.id,
      type: task.type,
      description: task.description,
      input: task.input,
      output: task.output,
      dependencies: task.dependencies,
      priority: task.priority,
      optional: task.optional || false
    }));
    
    // Initialize the plan
    const plan = {
      query: userQuery,
      steps,
      currentStepIndex: 0,
      results: [],
      startTime: Date.now(),
      stateManager
    };
    
    // Canonical ordering of reasoning steps
    const typeOrder = [
      'MEMORY_CHECK',
      'INTENT_CLASSIFICATION',
      'TOOL_SELECTION',
      'INFORMATION_GATHERING',
      'SYNTHESIS',
      'VERIFICATION'
    ];
    plan.steps.sort((a, b) => {
      const ia = typeOrder.indexOf(a.type);
      const ib = typeOrder.indexOf(b.type);
      const va = ia >= 0 ? ia : typeOrder.length;
      const vb = ib >= 0 ? ib : typeOrder.length;
      return va - vb;
    });
    
    // Ensure essential steps exist: MEMORY_CHECK at start, VERIFICATION at end
    const existingTypes = plan.steps.map(s => s.type);
    if (!existingTypes.includes('MEMORY_CHECK')) {
      plan.steps.unshift({
        id: `task-memory`,
        type: 'MEMORY_CHECK',
        description: 'Check if query can be answered from memory',
        input: 'User query',
        output: 'Memory check result',
        dependencies: [],
        priority: 0,
        optional: false
      });
    }
    if (!existingTypes.includes('VERIFICATION')) {
      plan.steps.push({
        id: `task-verification`,
        type: 'VERIFICATION',
        description: 'Verify the synthesized answer',
        input: 'Synthesized answer',
        output: 'Verification result',
        dependencies: [],
        priority: typeOrder.length,
        optional: false
      });
    }
    // Initialize state manager with the plan
    stateManager.initializePlan(plan);
    
    return plan;
  } catch (error) {
    logger.error(`Error planning query execution: ${error.message}`);
    // Return a default plan with basic steps as fallback
    const defaultSteps = getDefaultSteps();
    const stateManager = new ReasoningStateManager();
    
    const plan = {
      query: userQuery,
      steps: defaultSteps,
      currentStepIndex: 0,
      results: [],
      startTime: Date.now(),
      stateManager,
      error: error.message
    };
    
    stateManager.initializePlan(plan);
    return plan;
  }
}

/**
 * Generates a sequence of reasoning steps using LLM
 * @param {string} query - The user's query
 * @param {Array} facts - Known facts about the user
 * @param {string} historyContext - Conversation history
 * @returns {Array} Sequence of reasoning steps
 */
async function generateReasoningSteps(query, facts, historyContext, modelProvider) {
  try {
    // Use LLM to determine what steps are needed
    const prompt = `
You are a master planner for an AI agent. Your job is to determine the optimal sequence of reasoning steps to answer this query:

USER QUERY: "${query}"

KNOWN FACTS ABOUT USER:
${facts.map(f => `- ${f.type}: ${f.value}`).join('\n')}

CONVERSATION HISTORY:
${historyContext || "No previous conversation"}

Determine the optimal sequence of reasoning steps to answer this query.
Consider these potential step types:
- MEMORY_CHECK: Check if we already know the answer from user facts
- INTENT_CLASSIFICATION: Determine the user's intent
- TOOL_SELECTION: Select the most appropriate tool(s) to use
- INFORMATION_GATHERING: Gather required information using tools
- SYNTHESIS: Combine information to create a coherent answer
- VERIFICATION: Verify the accuracy and completeness of the answer

Output a JSON array of step objects, where each step has:
- type: The step type from the list above
- description: Brief description of what this step will do
- optional: true/false indicating if this step can be skipped

Example:
[
  {"type": "MEMORY_CHECK", "description": "Check if we already know user's car color", "optional": false},
  {"type": "TOOL_SELECTION", "description": "Select appropriate tools", "optional": false},
  {"type": "INFORMATION_GATHERING", "description": "Search for information about red cars", "optional": false},
  {"type": "SYNTHESIS", "description": "Combine facts about red cars with user context", "optional": false}
]
`;

    const model = modelProvider.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = await result.response.text();
    
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("Failed to extract steps JSON from LLM response");
      return getDefaultSteps();
    }
    
    const steps = JSON.parse(jsonMatch[0]);
    logger.info(`Generated ${steps.length} reasoning steps for query`);
    return steps;
  } catch (error) {
    logger.error(`Error generating reasoning steps: ${error.message}`);
    return getDefaultSteps();
  }
}

/**
 * Get default reasoning steps as fallback
 * @returns {Array} Default sequence of reasoning steps
 */
function getDefaultSteps() {
  return [
    { type: "MEMORY_CHECK", description: "Check if we already know the answer", optional: false },
    { type: "INTENT_CLASSIFICATION", description: "Classify user intent", optional: false },
    { type: "TOOL_SELECTION", description: "Select appropriate tools", optional: false },
    { type: "INFORMATION_GATHERING", description: "Gather required information", optional: false },
    { type: "SYNTHESIS", description: "Synthesize final answer", optional: false }
  ];
}

/**
 * Strategic tool selection based on task and context
 * @param {Object} task - The current task
 * @param {Object} context - Execution context
 * @returns {Array} Prioritized list of tools to try
 */
function prioritizeTools(task, context) {
  // Extract relevant context info
  const { userMsg, facts = [], toolHistory = {} } = context;
  
  // Default tool priorities
  const defaultPriorities = [
    { tool: 'WEB_SEARCH', confidence: 0.8 },
    { tool: 'READ_URL', confidence: 0.7 },
    { tool: 'REASONING_TOOL', confidence: 0.6 },
    { tool: 'RESPOND', confidence: 0.5 }
  ];
  
  // Create strategy map for different task types
  const strategyMap = {
    'INFORMATION_GATHERING': {
      // Strategies for user facts
      'user_facts': [
        { tool: 'MEMORY_CHECK', confidence: 0.9 },
        { tool: 'RESPOND', confidence: 0.7 }
      ],
      
      // Strategies for external knowledge
      'external_knowledge': [
        { tool: 'WEB_SEARCH', confidence: 0.9 },
        { tool: 'READ_URL', confidence: 0.8 },
        { tool: 'REASONING_TOOL', confidence: 0.7 }
      ],
      
      // Strategies for GitHub content
      'github_content': [
        { tool: 'READ_URL', confidence: 0.9, params: { useAPI: true } },
        { tool: 'WEB_SEARCH', confidence: 0.7 }
      ]
    }
  };
  
  // Determine the appropriate strategy based on context
  let strategy;
  
  // Check if task involves GitHub
  if (userMsg.toLowerCase().includes('github')) {
    strategy = strategyMap['INFORMATION_GATHERING']['github_content'];
  } 
  // Check if this is about user's own information
  else if (userMsg.toLowerCase().includes('my') || userMsg.toLowerCase().includes('i have')) {
    strategy = strategyMap['INFORMATION_GATHERING']['user_facts'];
  }
  // Default to external knowledge strategy for information gathering
  else if (task.type === 'INFORMATION_GATHERING') {
    strategy = strategyMap['INFORMATION_GATHERING']['external_knowledge'];
  }
  
  // Default if no specific strategy is found
  return strategy || defaultPriorities;
}

/**
 * Execute the next step in a reasoning plan
 * @param {Object} plan - The current reasoning plan
 * @param {Object} context - Execution context
 * @returns {Object} Updated plan with results from this step
 */
async function executeNextStep(plan, context) {
  if (plan.currentStepIndex >= plan.steps.length) {
    logger.info("Plan execution complete");
    return { ...plan, completed: true };
  }
  
  const currentStep = plan.steps[plan.currentStepIndex];
  const taskId = currentStep.id || `task-${plan.currentStepIndex}`;
  
  // Log detailed task information for debugging
  logTaskExecution(plan, taskId);
  
  // Validate if the step has all required inputs
  const validationResult = validateStepInputs(currentStep, plan);
  if (!validationResult.valid) {
    logger.warn(`Cannot execute step ${currentStep.type}: ${validationResult.reason}`);
    
    // If the issue can be fixed by inserting a step, do so
    if (validationResult.fixable) {
      const fixStep = createFixingStep(currentStep, validationResult);
      logger.info(`Inserting fixing step: ${fixStep.type} before ${currentStep.type}`);
      
      // Insert fixing step before the current step
      plan.steps.splice(plan.currentStepIndex, 0, fixStep);
      
      // Update state manager with the new step
      plan.stateManager.initializePlan(plan);
      
      // Execute the fixing step instead
      return executeNextStep(plan, context);
    }
    
    // Skip this step if validation failed and not fixable
    plan.stateManager.updateTaskState(taskId, TASK_STATES.SKIPPED);
    return {
      ...plan,
      currentStepIndex: plan.currentStepIndex + 1,
      skippedStep: true,
      lastStepSuccessful: false
    };
  }
  
  try {
    // Update task state to in progress
    plan.stateManager.updateTaskState(taskId, TASK_STATES.IN_PROGRESS);
    
    let stepResult;
    
    // Execute the appropriate step type
    switch (currentStep.type) {
      case "MEMORY_CHECK":
        stepResult = await executeMemoryCheck(plan.query, context.facts);
        break;
      case "INTENT_CLASSIFICATION":
        stepResult = await executeIntentClassification(plan.query, context);
        break;
      case "TOOL_SELECTION":
        // Use enhanced tool prioritization
        const toolPriorities = prioritizeTools(currentStep, context);
        stepResult = await executeToolSelection(plan.query, context, toolPriorities);
        break;
      case "INFORMATION_GATHERING":
        stepResult = await executeInformationGathering(plan.query, context);
        break;
      case "SYNTHESIS":
        stepResult = await executeSynthesis(plan.query, plan.results, context);
        break;
      case "VERIFICATION":
        stepResult = await executeVerification(plan.query, plan.results, context);
        break;
      default:
        stepResult = { success: false, error: `Unknown step type: ${currentStep.type}` };
    }
    
    // Record the success
    plan.stateManager.recordSuccess(taskId, stepResult);
    
    // Update the plan with results from this step
    const updatedResults = [...plan.results, { step: currentStep, result: stepResult }];
    
    return {
      ...plan,
      results: updatedResults,
      currentStepIndex: plan.currentStepIndex + 1,
      completed: plan.currentStepIndex + 1 >= plan.steps.length,
      lastStepSuccessful: true
    };
    
  } catch (error) {
    logger.error(`Error executing step: ${error.message}`);
    
    // Record the failure
    plan.stateManager.recordFailure(taskId, currentStep.type, error);
    
    // Check if we can retry with an alternative approach
    const alternative = plan.stateManager.suggestAlternativeApproach(taskId, context);
    
    if (alternative && alternative.approach !== 'ASK_CLARIFICATION') {
      logger.info(`Retrying task ${taskId} with alternative approach: ${alternative.approach}`);
      
      // Try the alternative approach
      try {
        let retryResult;
        
        switch (alternative.approach) {
          case 'WEB_SEARCH':
            retryResult = await executeToolWithName('WEB_SEARCH', plan.query, context);
            break;
          case 'READ_URL':
            retryResult = await executeToolWithName('READ_URL', plan.query, context);
            break;
          case 'REASONING_TOOL':
            retryResult = await executeToolWithName('REASONING_TOOL', plan.query, context);
            break;
          case 'SINGLE_URL_PROCESSING':
            retryResult = await executeSingleUrlProcessing(context);
            break;
          case 'DIRECT_SYNTHESIS':
            retryResult = await executeDirectSynthesis(plan.query, context);
            break;
          default:
            retryResult = { success: false, error: `Unknown alternative approach: ${alternative.approach}` };
        }
        
        // Record the success of the alternative approach
        plan.stateManager.recordSuccess(taskId, retryResult);
        
        // Update the plan with results from this step
        const updatedResults = [...plan.results, { 
          step: currentStep, 
          result: retryResult,
          alternative: alternative.approach
        }];
        
        return {
          ...plan,
          results: updatedResults,
          currentStepIndex: plan.currentStepIndex + 1,
          completed: plan.currentStepIndex + 1 >= plan.steps.length,
          lastStepSuccessful: true,
          usedAlternative: true
        };
        
      } catch (retryError) {
        // Record the failure of the alternative approach
        plan.stateManager.recordFailure(taskId, alternative.approach, retryError);
      }
    }
    
    // If the step is optional, skip it
    if (currentStep.optional) {
      logger.info(`Skipping optional step ${currentStep.type} due to error`);
      
      plan.stateManager.updateTaskState(taskId, TASK_STATES.SKIPPED);
      
      return {
        ...plan,
        currentStepIndex: plan.currentStepIndex + 1,
        completed: plan.currentStepIndex + 1 >= plan.steps.length,
        lastStepSuccessful: false,
        skippedStep: true
      };
    }
    
    // If we reach here, both the main approach and alternative failed
    return {
      ...plan,
      error: error.message,
      currentStepIndex: plan.currentStepIndex + 1, // Move to next step anyway
      completed: plan.currentStepIndex + 1 >= plan.steps.length,
      lastStepSuccessful: false
    };
  }
}

/**
 * Validate if a step has all required inputs
 * @param {Object} step - The step to validate
 * @param {Object} plan - The current plan with results
 * @returns {Object} Validation result
 */
function validateStepInputs(step, plan) {
  const previousResults = plan.results || [];
  
  switch (step.type) {
    case "SYNTHESIS":
      // Check if we have information to synthesize
      const infoResults = previousResults.filter(r => 
        r.step.type === 'INFORMATION_GATHERING' && r.result.success
      );
      
      if (infoResults.length === 0) {
        return { 
          valid: false, 
          reason: "No information available for synthesis",
          fixable: true,
          missingStep: "INFORMATION_GATHERING"
        };
      }
      break;
      
    case "VERIFICATION":
      // Check if we have a response to verify
      const synthResults = previousResults.filter(r => 
        r.step.type === 'SYNTHESIS' && r.result.success
      );
      
      if (synthResults.length === 0) {
        return { 
          valid: false, 
          reason: "No synthesis result available for verification",
          fixable: true,
          missingStep: "SYNTHESIS"
        };
      }
      break;
      
    case "INFORMATION_GATHERING":
      // Check if we have a tool selected
      const toolResults = previousResults.filter(r => 
        r.step.type === 'TOOL_SELECTION' && r.result.success
      );
      
      if (toolResults.length === 0) {
        return { 
          valid: false, 
          reason: "No tool selected for information gathering",
          fixable: true,
          missingStep: "TOOL_SELECTION"
        };
      }
      break;
  }
  
  return { valid: true };
}

/**
 * Create a fixing step when validation fails
 * @param {Object} originalStep - The step that failed validation
 * @param {Object} validation - The validation result
 * @returns {Object} A new step to fix the issue
 */
function createFixingStep(originalStep, validation) {
  return {
    id: `fix-${originalStep.id}`,
    type: validation.missingStep,
    description: `Auto-generated ${validation.missingStep} step to fix missing input for ${originalStep.type}`,
    optional: false,
    // Ensure dependencies is always defined as an array
    dependencies: originalStep.dependencies || []
  };
}

/**
 * Log detailed task execution information
 * @param {Object} plan - The current plan
 * @param {string} taskId - The ID of the task being executed
 */
function logTaskExecution(plan, taskId) {
  const task = plan.stateManager.tasks.get(taskId);
  if (!task) return;
  
  const taskStatus = plan.stateManager.getTaskStatus();
  
  logger.info(`Executing task ${taskId} (${task.type}): ${task.description}`);
  
  // Ensure task.dependencies exists before using join
  if (task.dependencies) {
    logger.debug(`Task dependencies: ${task.dependencies.join(', ') || 'none'}`);
  } else {
    logger.debug(`Task dependencies: none`);
  }
  
  logger.debug(`Task status: ${JSON.stringify(taskStatus)}`);
  
  // Log previous results that might be inputs to this task
  const relevantResults = plan.results.filter(r => 
    task.dependencies && r.step && r.step.id && task.dependencies.includes(r.step.id)
  );
  
  if (relevantResults.length > 0) {
    logger.debug(`Available inputs: ${relevantResults.map(r => r.step.id).join(', ')}`);
  } else if (task.dependencies && task.dependencies.length > 0) {
    logger.warn(`Task ${taskId} has dependencies but no results available from them`);
  }
}

/**
 * Process a single URL when multiple URL handling fails
 * @param {Object} context - Execution context with URL information
 * @returns {Object} Result of processing a single URL
 */
async function executeSingleUrlProcessing(context) {
  try {
    // Extract a single URL from context
    let url = null;
    
    if (context.urls && Array.isArray(context.urls) && context.urls.length > 0) {
      url = context.urls[0];
    } else if (context.toolHistory && context.toolHistory.url_reads && context.toolHistory.url_reads.length > 0) {
      url = context.toolHistory.url_reads[context.toolHistory.url_reads.length - 1];
    } else if (typeof context.userMsg === 'string' && context.userMsg.includes('http')) {
      // Try to extract URL from user message
      const urlMatch = context.userMsg.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        url = urlMatch[1];
      }
    }
    
    if (!url) {
      return { success: false, error: "No URL found to process" };
    }
    
    // Process the single URL
    const toolFn = require('../tools')['READ_URL'];
    const result = await toolFn.run({ url }, context);
    
    return {
      success: !result.error,
      url,
      content: result.result,
      information: `URL: ${url}\nContent: ${JSON.stringify(result.result)}`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Execute direct synthesis when regular synthesis fails
 * @param {string} query - The user query
 * @param {Object} context - Execution context
 * @returns {Object} Synthesis result
 */
async function executeDirectSynthesis(query, context) {
  try {
    // Use whatever information we have in the context
    let combinedInfo = '';
    
    // Try to extract information from context
    if (context.toolHistory && context.toolHistory.url_reads) {
      combinedInfo += `URLs read: ${context.toolHistory.url_reads.join(', ')}\n`;
    }
    
    if (context.toolHistory && context.toolHistory.web_searches) {
      combinedInfo += `Web searches performed: ${context.toolHistory.web_searches.join(', ')}\n`;
    }
    
    // Use the user query directly if we don't have much info
    if (combinedInfo.length < 50) {
      combinedInfo = `Query: ${query}\n`;
    }
    
    // Use LLM to synthesize a response
    const model = context.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
Based on the limited information available, create a response that addresses the user's query as best as possible.

USER QUERY: "${query}"

AVAILABLE INFORMATION:
${combinedInfo}

Please provide:
1. A direct answer to the query with the information available
2. An acknowledgment of any limitations in the response
3. Suggestions for how the user could get better results

Keep your response concise and helpful.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response.text();
    
    return {
      success: true,
      response,
      directSynthesis: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Utility for executing a specific tool by name
async function executeToolWithName(toolName, query, context) {
  try {
    const toolFn = require('../tools')[toolName];
    if (!toolFn) {
      throw new Error(`Tool ${toolName} not found`);
    }
    
    // Create parameters based on tool requirements
    let params = {};
    
    // Map parameters based on tool type
    switch(toolName) {
      case 'REASONING_TOOL':
        params = { problem: query };
        break;
      case 'WEB_SEARCH':
        params = { query };
        break;
      case 'READ_URL':
        params = { url: query };
        break;
      default:
        params = { query };
    }
    
    // Add any additional parameters from context
    if (context.additionalParams) {
      params = { ...params, ...context.additionalParams };
    }
    
    return await toolFn.run(params, context);
  } catch (error) {
    throw new Error(`Error executing tool ${toolName}: ${error.message}`);
  }
}

// Step execution functions

// Execute memory check step
async function executeMemoryCheck(query, facts) {
  const memoryManager = require('../memory/memory_manager');
  const result = await memoryManager.checkMemoryForAnswer(query, global.genAI);
  return {
    success: result.found,
    answer: result.answer,
    confidence: result.confidence,
    missingInformation: result.reason || result.missingInformation
  };
}

// Execute intent classification step
async function executeIntentClassification(query, context) {
  const intentClassifier = require('./intent_classifier');
  const classification = await intentClassifier.classifyIntent(
    query,
    { historyContext: context.historyContext, facts: context.facts },
    context.genAI
  );
  context.intentClassification = classification;
  return {
    success: true,
    intent: classification.intent,
    confidence: classification.confidence
  };
}

// Execute tool selection step
async function executeToolSelection(query, context, priorities) {
  const toolSelector = require('./tool_selector');
  const intent = (context.intentClassification && context.intentClassification.intent) || 'unknown';
  const decision = await toolSelector.selectTools(
    query,
    intent,
    context.facts,
    context.historyContext,
    context.toolHistory,
    context.genAI
  );
  context.selectedTool = decision.tool;
  context.additionalToolParams = decision.parameters || {};
  return {
    success: true,
    selectedTool: decision.tool,
    parameters: decision.parameters,
    reasoning: decision.reasoning
  };
}

// Execute synthesis step
async function executeSynthesis(query, results, context) {
  // If the information gathering step used REASONING_TOOL, assemble a structured report
  const infoToolStep = results.find(r => r.step.type === 'INFORMATION_GATHERING' && r.result.selectedTool === 'REASONING_TOOL');
  if (infoToolStep && infoToolStep.result.toolResult) {
    const rt = infoToolStep.result.toolResult;
    // Build detailed report sections
    let report = `Report for "${query}":\n`;
    if (rt.problemType) report += `\nProblem Type: ${rt.problemType}\n`;
    if (rt.reasoningApproach) report += `Approach: ${rt.reasoningApproach}\n`;
    if (Array.isArray(rt.steps) && rt.steps.length) {
      report += `\nSteps:\n`;
      rt.steps.forEach((step, i) => report += `${i+1}. ${step}\n`);
    }
    if (rt.conclusion) report += `\nConclusion: ${rt.conclusion}\n`;
    if (rt.confidence !== undefined) report += `Confidence: ${rt.confidence}\n`;
    return { success: true, response: report };
  }
  // Otherwise fallback to summarising web/GitHub results or direct synthesis
  // Try to summarise results from standard information gathering
  const infoStep = results.find(r => r.step.type === 'INFORMATION_GATHERING' && r.result.success);
  if (infoStep && infoStep.result.toolResult) {
    const tr = infoStep.result.toolResult;
    // Web search results
    if (Array.isArray(tr.results)) {
      const hits = tr.results;
      const summaryLines = hits.map((item, idx) => {
        const title = item.title || item.snippet || item.url;
        return `${idx+1}. ${title} (${item.url})`;
      });
      const summary = summaryLines.join('\n');
      return { success: true, response: `I found the following top results for "${query}":\n${summary}` };
    }
    // READ_URL content
    if (tr.content) {
      return { success: true, response: `Here is the content from ${tr.url}:\n${tr.content}` };
    }
  }
  // Fallback to LLM direct synthesis
  return executeDirectSynthesis(query, context);
}

// Execute verification step
async function executeVerification(query, results, context) {
  const synth = results.find(r => r.step.type === 'SYNTHESIS');
  if (synth && synth.result && synth.result.response) {
    return { success: true, response: synth.result.response };
  }
  return { success: false, error: 'No synthesis result available for verification' };
}

/**
 * Execute information gathering step with improved URL handling
 */
async function executeInformationGathering(query, context) {
  try {
    // Get the selected tool from previous results
    let selectedTool = 'WEB_SEARCH'; // Default
    let toolParams = {};
    
    // Check previous results for tool selection
    if (context.selectedTool) {
      selectedTool = context.selectedTool;
    }
    
    // If we have specific URLs to read and the selected tool is READ_URL
    if (context.urls && Array.isArray(context.urls) && selectedTool === 'READ_URL') {
      // Process URLs one by one
      const results = [];
      for (const url of context.urls) {
        try {
          const toolFn = require('../tools')['READ_URL'];
          const result = await toolFn.run({ url }, context);
          results.push({
            url,
            content: result.result,
            success: !result.error,
            error: result.error
          });
        } catch (error) {
          results.push({
            url,
            error: error.message,
            success: false
          });
        }
      }
      
      return {
        success: results.some(r => r.success),
        results,
        information: results
          .filter(r => r.success)
          .map(r => `URL: ${r.url}\nContent: ${typeof r.content === 'string' ? r.content.substring(0, 500) + '...' : JSON.stringify(r.content)}`)
          .join('\n\n')
      };
    }
    
    // For other tools, run the selected tool
    const toolFn = require('../tools')[selectedTool];
    if (!toolFn) {
      return { 
        success: false, 
        error: `Tool ${selectedTool} not found`
      };
    }
    
    // Prepare parameters based on the tool
    if (selectedTool === 'REASONING_TOOL') {
      toolParams = { problem: query };
    } else if (selectedTool === 'WEB_SEARCH') {
      toolParams = { query };
    } else {
      toolParams = { query };
    }
    
    // Add any additional parameters from context
    if (context.additionalToolParams) {
      toolParams = { ...toolParams, ...context.additionalToolParams };
    }
    
    const result = await toolFn.run(toolParams, context);
    
    return {
      success: !result.error,
      information: result.error ? `Error: ${result.error}` : JSON.stringify(result),
      toolResult: result,
      selectedTool
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  planQueryExecution,
  executeNextStep,
  generateReasoningSteps,
  ReasoningStateManager,
  decomposeQuery,
  TASK_STATES,
  enforceLogicalDependencies,  // Export new utility functions
  validateStepInputs,
  executeToolWithName
}; 