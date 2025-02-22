import { parseArgs } from "@std/cli/parse-args";
// Direct import from esm.sh CDN
import { GoogleGenerativeAI } from "@google/generative-ai";

const gitCommand = Deno.env.get('GIT_COMMAND') || '/usr/bin/git';

// Function to initialize OpenAI service
function createOpenAIService() {
    const apiKey = Deno.env.get('OPENAI_API_KEY') || '';
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set. Please set it using "export OPENAI_API_KEY=your-key"');
    }

    async function generateMessage(diff: string): Promise<string> {
        const prompt = `Write a concise Git commit message that summarizes the following code changes:\n\n${diff}`;
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI API request failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.choices || !data.choices[0]?.message?.content) {
            throw new Error('Invalid response format from OpenAI API');
        }
        return data.choices[0].message.content.trim();
    }

    return { generateMessage };
}

// Function to initialize Google Gemini service using SDK
function createGoogleService() {
    const apiKey = Deno.env.get('GOOGLE_API_KEY') || '';
    if (!apiKey) {
        throw new Error('GOOGLE_API_KEY environment variable is not set. Please set it using "export GOOGLE_API_KEY=your-key"');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using a valid model name

    async function generateMessage(diff: string): Promise<string> {
        const prompt = `Write a concise Git commit message that summarizes the following code changes:\n\n${diff}`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (!text) {
            throw new Error('No content generated from Google Gemini API');
        }
        return text.trim();
    }

    return { generateMessage };
}

// Function to initialize Claude service (placeholder)
function createClaudeService() {
    async function generateMessage(diff: string): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, 0));
        throw new Error('Claude service not implemented yet');
    }

    return { generateMessage };
}

// Check if the current directory is a Git repository
async function isGitRepository(): Promise<boolean> {
    const process = new Deno.Command(gitCommand, {
        args: ['rev-parse', '--is-inside-work-tree'],
        stdout: 'piped',
        env: { PATH: Deno.env.get('PATH') || '' }, // Explicitly set PATH
    });
    const { code } = await process.output();
    return code === 0;
}

// Fetch the diff based on the specified source
async function getDiff(source: string): Promise<string> {
    let cmd: string[];
    if (source === 'staged') {
        cmd = ['diff', '--cached'];
    } else if (source === 'last') {
        cmd = ['show', 'HEAD'];
    } else if (source.startsWith('commit:')) {
        const commitHash = source.split(':')[1];
        cmd = ['show', commitHash];
    } else {
        throw new Error('Invalid source');
    }

    console.log('Running git command:', [gitCommand, ...cmd].join(' ')); // Log the command being executed

    const process = new Deno.Command(gitCommand, {
        args: cmd,
        stdout: 'piped',
        stderr: 'piped', // Capture stderr for error messages
        env: { PATH: Deno.env.get('PATH') || '' }, // Explicitly set PATH
    });

    const { code, stdout, stderr } = await process.output();

    if (code !== 0) {
        const errorMessage = new TextDecoder().decode(stderr);
        throw new Error(`Git command failed: ${errorMessage}`);
    }

    const diffOutput = new TextDecoder().decode(stdout);
    // console.log('Git command output:', diffOutput); // Log the raw output

    return diffOutput;
}

// Main function to run the CLI app
async function main() {
    const args = parseArgs(Deno.args, {
        string: ['ai', 'source'],
        boolean: ['help', 'verbose', 'command'],
        alias: { h: 'help', v: 'verbose', c: 'command' },
        default: { ai: 'openai', source: 'staged', help: false, verbose: false, command: false },
    });

    if (args.help) {
        console.log(`Usage: app-name [options]

Options:
  --ai <provider>    Select AI provider (openai, claude, google)
  --source <source>  Specify the source of changes (staged, commit:<hash>, last)
  --verbose          Show the diff alongside the message
  --command          Output the full git commit command
  --help             Show this help message
`);
        Deno.exit(0);
    }

    if (!(await isGitRepository())) {
        console.error('Not a Git repository.');
        return;
    }

    const supportedProviders = ['openai', 'claude', 'google'];
    if (!supportedProviders.includes(args.ai)) {
        throw new Error(`Unsupported AI provider: ${args.ai}. Supported providers: ${supportedProviders.join(', ')}`);
    }

    // Select AI service based on argument
    let aiService;
    switch (args.ai) {
        case 'openai':
            aiService = createOpenAIService();
            break;
        case 'claude':
            aiService = createClaudeService();
            break;
        case 'google':
            aiService = createGoogleService();
            break;
        default:
            throw new Error('Invalid AI provider');
    }

    const diff = await getDiff(args.source);
    if (!diff.trim()) {
        console.log('No changes to generate a message for.');
        return;
    }

    if (args.verbose) {
        console.log('Original Diff:');
        console.log(diff);
    }

    const message = await aiService.generateMessage(diff);
    console.log('Suggested Commit Message:');
    console.log(message);

    if (args.command) {
        console.log('\nRun the following command to commit:');
        console.log(`git commit -m "${message}"`);
    }
}

main().catch(error => {
    console.error('Error:', error.message);
});