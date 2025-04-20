/* backend/thinking_logic.js */
"use strict";
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// ThoughtStage enum and helper
const ThoughtStage = {
	PROBLEM_DEFINITION: "Problem Definition",
	RESEARCH: "Research",
	ANALYSIS: "Analysis",
	SYNTHESIS: "Synthesis",
	CONCLUSION: "Conclusion"
};
const validStages = Object.values(ThoughtStage);
function fromString(value) {
	if (validStages.includes(value)) return value;
	throw new Error(`Invalid thinking stage: '${value}'. Valid stages are: ${validStages.join(", ")}`);
}

// ThoughtData class
class ThoughtData {
	constructor(thought, thoughtNumber, totalThoughts, nextThoughtNeeded, stage, tags = [], axiomsUsed = [], assumptionsChallenged = []) {
		this.thought = thought;
		this.thoughtNumber = thoughtNumber;
		this.totalThoughts = totalThoughts;
		this.nextThoughtNeeded = nextThoughtNeeded;
		this.stage = stage;
		this.tags = tags;
		this.axiomsUsed = axiomsUsed;
		this.assumptionsChallenged = assumptionsChallenged;
	}
	validate() {
		if (this.thoughtNumber < 1) {
			throw new Error("Thought number must be positive");
		}
		if (this.totalThoughts < this.thoughtNumber) {
			throw new Error("Total thoughts must be greater or equal to current thought number");
		}
		return true;
	}
}

// Global thought history container
let thoughtHistory = [];

// Suggestions for next actions based on stage
const stageSuggestions = {
	[ThoughtStage.PROBLEM_DEFINITION]: [
		"Refine the problem statement with specific details.",
		"Identify any constraints or requirements.",
		"Consider the stakeholders involved."
	],
	[ThoughtStage.RESEARCH]: [
		"Gather data from reliable sources.",
		"Document key findings and references.",
		"List any knowledge gaps still remaining."
	],
	[ThoughtStage.ANALYSIS]: [
		"Compare different data points for patterns.",
		"Challenge any assumptions made during research.",
		"Identify any conflicting information."
	],
	[ThoughtStage.SYNTHESIS]: [
		"Combine your insights into a cohesive proposal.",
		"Outline the structure of your recommendation.",
		"Prepare a draft summary of findings."
	],
	[ThoughtStage.CONCLUSION]: [
		"Summarize the main takeaways clearly.",
		"Suggest next steps or future investigations.",
		"Reflect on lessons learned."
	]
};

// Helper functions for modular thinking steps
function validateThoughtData(data) {
	if (data.thoughtNumber < 1) throw new Error("Thought number must be positive");
	if (data.totalThoughts < data.thoughtNumber) throw new Error("Total thoughts must be greater or equal to current thought number");
	return true;
}

function getRelatedThoughts(history, stage, currentThought, limit = 3) {
	return history.filter(t => t.stage === stage && t !== currentThought).slice(0, limit);
}

function computeNextActions(stage) {
	return stageSuggestions[stage] || [];
}

function suggestTags(relatedThoughts, existingTags = [], limit = 3) {
	const tags = relatedThoughts.flatMap(t => t.tags);
	const freq = tags.reduce((acc, tag) => { acc[tag] = (acc[tag] || 0) + 1; return acc; }, {});
	return Object.entries(freq)
		.filter(([tag]) => !existingTags.includes(tag))
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([tag]) => tag);
}

function summarizeAxioms(relatedThoughts) {
	const allAxioms = relatedThoughts.flatMap(t => t.axiomsUsed);
	const uniqueAxioms = [...new Set(allAxioms)];
	return { count: uniqueAxioms.length, axioms: uniqueAxioms };
}

function summarizeAssumptions(relatedThoughts) {
	const allAssumptions = relatedThoughts.flatMap(t => t.assumptionsChallenged);
	const uniqueAssumptions = [...new Set(allAssumptions)];
	return { count: uniqueAssumptions.length, assumptions: uniqueAssumptions };
}

// Endpoint: process-thought
app.post("/process-thought", (req, res) => {
	try {
		const {
			thought,
			thought_number,
			total_thoughts,
			next_thought_needed,
			stage,
			tags = [],
			axioms_used = [],
			assumptions_challenged = []
		} = req.body;
		const thoughtStage = fromString(stage);
		const thoughtData = new ThoughtData(
			thought,
			thought_number,
			total_thoughts,
			next_thought_needed,
			thoughtStage,
			tags,
			axioms_used,
			assumptions_challenged
		);

		// Modularized reasoning pipeline
		console.time('validateThoughtData');
		validateThoughtData(thoughtData);
		console.timeEnd('validateThoughtData');
		thoughtHistory.push(thoughtData);

		console.time('getRelatedThoughts');
		const relatedThoughts = getRelatedThoughts(thoughtHistory, thoughtStage, thoughtData);
		console.timeEnd('getRelatedThoughts');

		console.time('computeNextActions');
		const nextActions = computeNextActions(thoughtStage);
		console.timeEnd('computeNextActions');

		console.time('suggestTags');
		const suggestedTags = suggestTags(relatedThoughts, thoughtData.tags);
		console.timeEnd('suggestTags');

		console.time('summarizeAxioms');
		const axiomsSummary = summarizeAxioms(relatedThoughts);
		console.timeEnd('summarizeAxioms');

		console.time('summarizeAssumptions');
		const assumptionsSummary = summarizeAssumptions(relatedThoughts);
		console.timeEnd('summarizeAssumptions');

		const reasoningSteps = [
			`Validated thought #${thoughtData.thoughtNumber}.`,
			`Retrieved ${relatedThoughts.length} related thoughts.`,
			`Computed ${nextActions.length} next actions.`,
			`Suggested ${suggestedTags.length} tags.`,
			`Summarized ${axiomsSummary.count} axioms and ${assumptionsSummary.count} assumptions.`
		];

		const response = {
			thoughtAnalysis: {
				currentThought: {
					thoughtNumber: thoughtData.thoughtNumber,
					totalThoughts: thoughtData.totalThoughts,
					nextThoughtNeeded: thoughtData.nextThoughtNeeded,
					stage: thoughtData.stage,
					tags: thoughtData.tags,
					timestamp: new Date().toISOString()
				},
				analysis: {
					relatedThoughtsCount: relatedThoughts.length,
					relatedThoughtSummaries: relatedThoughts.map(t => ({
						thoughtNumber: t.thoughtNumber,
						stage: t.stage,
						snippet: t.thought.length > 100 ? t.thought.substring(0, 100) + "..." : t.thought
					}))
				},
				context: {
					thoughtHistoryLength: thoughtHistory.length,
					currentStage: thoughtData.stage
				},
				nextActions,
				reasoningSteps,
				suggestedTags,
				axiomsSummary,
				assumptionsSummary
			}
		};

		res.json(response);
	} catch (e) {
		res.json({ error: e.message, status: "failed" });
	}
});

// Endpoint: generate-summary
app.get("/generate-summary", (req, res) => {
	if (thoughtHistory.length === 0) {
		res.json({ summary: "No thoughts recorded yet" });
		return;
	}
	const stages = {};
	thoughtHistory.forEach(thought => {
		if (!stages[thought.stage]) stages[thought.stage] = [];
		stages[thought.stage].push(thought);
	});
	const summary = {
		totalThoughts: thoughtHistory.length,
		stages: Object.keys(stages).reduce((acc, stage) => {
			acc[stage] = stages[stage].length;
			return acc;
		}, {}),
		timeline: thoughtHistory
			.sort((a, b) => a.thoughtNumber - b.thoughtNumber)
			.map(t => ({ number: t.thoughtNumber, stage: t.stage }))
	};
	res.json({ summary });
});

// Endpoint: clear-history
app.post("/clear-history", (req, res) => {
	thoughtHistory = [];
	res.json({ status: "success", message: "Thought history cleared" });
});

app.listen(port, () => {
	console.log(`Thinking logic server running on port ${port}`);
});