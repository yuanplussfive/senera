import bayes from "classificator";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";

export type AgentTurnValueLabel = "valuable" | "unproductive";

export interface AgentTurnValueTrainingExample {
  readonly promptText: string;
  readonly label: AgentTurnValueLabel;
  readonly occurrences: number;
}

export interface AgentTurnValueClassifierPolicy {
  readonly enabled: boolean;
  readonly confidenceThreshold: number;
  readonly minimumExamplesPerLabel: number;
}

export interface AgentTurnValueClassification {
  readonly label: AgentTurnValueLabel | "unknown";
  readonly confidence: number;
  readonly trainedExamples: Readonly<Record<AgentTurnValueLabel, number>>;
}

/** Local incremental classifier used only after the model has produced a grounded learning result. */
export class AgentTurnValueClassifier {
  private readonly tokenizer = new AgentToolSearchTokenizer();
  private model: ReturnType<typeof bayes> | undefined;
  private modelKey = "";

  classify(
    promptText: string,
    examples: readonly AgentTurnValueTrainingExample[],
    policy: AgentTurnValueClassifierPolicy,
  ): AgentTurnValueClassification {
    const trainedExamples = countExamples(examples);
    if (!policy.enabled || !promptText.trim() || !hasMinimumTraining(trainedExamples, policy)) {
      return unknownClassification(trainedExamples);
    }

    const classifier = this.modelFor(examples);
    const result = classifier.categorizeWithConfidence(promptText, policy.confidenceThreshold);
    const predicted = result.predictedCategory;
    if (predicted !== "valuable" && predicted !== "unproductive") {
      return unknownClassification(trainedExamples, result.likelihoods[0]?.proba ?? 0);
    }
    return {
      label: predicted,
      confidence: result.likelihoods.find((entry) => entry.category === predicted)?.proba ?? 0,
      trainedExamples,
    };
  }

  private modelFor(examples: readonly AgentTurnValueTrainingExample[]): ReturnType<typeof bayes> {
    const modelKey = examples
      .map((example) => `${example.label}\u0000${example.promptText}\u0000${example.occurrences}`)
      .sort()
      .join("\u0001");
    if (this.model && this.modelKey === modelKey) return this.model;
    const model = bayes({
      tokenizer: (text) => this.tokenizer.tokenize(text),
      fitPrior: false,
    });
    model.learnBatch(
      examples.map((example) => ({
        text: example.promptText,
        category: example.label,
      })),
    );
    this.model = model;
    this.modelKey = modelKey;
    return model;
  }
}

function countExamples(
  examples: readonly AgentTurnValueTrainingExample[],
): Readonly<Record<AgentTurnValueLabel, number>> {
  return {
    valuable: examples.filter((example) => example.label === "valuable").length,
    unproductive: examples.filter((example) => example.label === "unproductive").length,
  };
}

function hasMinimumTraining(
  examples: Readonly<Record<AgentTurnValueLabel, number>>,
  policy: AgentTurnValueClassifierPolicy,
): boolean {
  return examples.valuable >= policy.minimumExamplesPerLabel && examples.unproductive >= policy.minimumExamplesPerLabel;
}

function unknownClassification(
  trainedExamples: Readonly<Record<AgentTurnValueLabel, number>>,
  confidence = 0,
): AgentTurnValueClassification {
  return { label: "unknown", confidence, trainedExamples };
}
