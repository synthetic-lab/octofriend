import os
from unfat.axolotl import llama_3_1_8b_axolotl
from unfat.lora import LoraSettings
from unfat.datasets import JsonlConvos, Dataset

output_dir = "output"

train_config = llama_3_1_8b_axolotl(
    dataset=Dataset(
        train=[
            JsonlConvos("data/train.jsonl"),
        ],
        eval=[
            JsonlConvos("data/eval.jsonl"),
        ],
    ),
    settings=LoraSettings(
        rank=32,
        alpha=16,
        dropout=0.01,
        num_epochs=2,
        evals_per_epoch=10,
        learning_rate=4e-4,
        wandb_api_key=os.environ["WANDB_API_KEY"],
        wandb_project="json-fix",
    ),
    warmup_steps=10,
)

train_config.save(output_dir)
