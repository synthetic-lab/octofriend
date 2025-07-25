import os
from unfat.together import llama_3_1_8b_together
from unfat.lora import LoraSettings
from unfat.datasets import JsonlConvos, Dataset

output_dir = "output"

train_config = llama_3_1_8b_together(
    output_dir=output_dir,
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
        num_epochs=8,
        learning_rate=4e-4,
        wandb_api_key=os.environ["WANDB_API_KEY"],
        wandb_project="octofriend-fast-apply",
    ),
    api_key=os.environ["TOGETHER_API_KEY"],
)

uploaded_files = train_config.upload_files()
train_config.finetune(uploaded_files)
