"""
Modal serverless deployment for Llama 3.1 8B Instruct.
Serves an OpenAI-compatible /v1/chat/completions endpoint.

Deploy:  modal deploy modal_llama.py
Test:    curl -X POST https://<your-modal-url>/v1/chat/completions \
           -H "Content-Type: application/json" \
           -d '{"messages":[{"role":"user","content":"Hello!"}],"max_tokens":128}'
"""

import modal

# ─── Model config ───
MODEL_ID = "meta-llama/Meta-Llama-3.1-8B-Instruct"
MODEL_REVISION = "main"
GPU_CONFIG = modal.gpu.A10G(count=1)  # A10G is cheap and fast for 8B

# ─── Modal app ───
app = modal.App("sushi-llama-8b")

# ─── Container image with vLLM + HuggingFace model ───
vllm_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm==0.6.6.post1",
        "torch==2.5.1",
        "transformers>=4.45.0",
        "huggingface_hub[hf_transfer]>=0.26.2",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)


# ─── vLLM inference engine ───
@app.cls(
    gpu=GPU_CONFIG,
    container_idle_timeout=300,  # 5 min idle before cold
    allow_concurrent_inputs=32,
    image=vllm_image,
    secrets=[modal.Secret.from_name("huggingface-secret", required=False)],
)
class LlamaModel:
    @modal.enter()
    def load_model(self):
        from vllm.engine.arg_utils import AsyncEngineArgs
        from vllm.engine.async_llm_engine import AsyncLLMEngine

        engine_args = AsyncEngineArgs(
            model=MODEL_ID,
            revision=MODEL_REVISION,
            max_model_len=4096,
            gpu_memory_utilization=0.90,
            enforce_eager=False,
            dtype="auto",
        )
        self.engine = AsyncLLMEngine.from_engine_args(engine_args)
        self.tokenizer = None  # Will be loaded on first request

    @modal.method()
    async def generate(self, messages: list, max_tokens: int = 512, temperature: float = 0.7):
        from vllm.sampling_params import SamplingParams
        import uuid

        # Build prompt from messages using the tokenizer's chat template
        if self.tokenizer is None:
            from transformers import AutoTokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

        prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        sampling_params = SamplingParams(
            max_tokens=min(max_tokens, 1024),
            temperature=max(temperature, 0.01),
            top_p=0.95,
            stop=["<|eot_id|>", "<|end_of_text|>"],
        )

        request_id = str(uuid.uuid4())
        result_text = ""

        async for output in self.engine.generate(prompt, sampling_params, request_id):
            if output.finished:
                result_text = output.outputs[0].text
                break

        return result_text


# ─── Web endpoint (OpenAI-compatible) ───
@app.function(
    image=vllm_image,
    allow_concurrent_inputs=64,
    container_idle_timeout=300,
)
@modal.web_endpoint(method="POST", docs=True)
async def chat_completions(request: dict):
    """OpenAI-compatible chat completions endpoint."""
    import time

    messages = request.get("messages", [])
    max_tokens = request.get("max_tokens", 512)
    temperature = request.get("temperature", 0.7)

    if not messages:
        return {"error": "No messages provided", "status": 400}

    model = LlamaModel()
    result = await model.generate.remote.aio(
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )

    # Return OpenAI-compatible response
    return {
        "id": f"chatcmpl-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": -1,
            "completion_tokens": -1,
            "total_tokens": -1,
        },
    }
