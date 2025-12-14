export const clr = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
  };
  
  export async function printStream(stream: any) {
    for await (const event of stream) {
      const [nodeName, output] = Object.entries(event)[0];
  
      if (nodeName === 'Agent') {
        const messages = (output as any).messages;
        if (messages?.length) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.content) console.log(`\n${clr.cyan}🤖 Agent:${clr.reset} ${lastMsg.content}`);
        }
      }
      if (nodeName === 'tools') {
         const messages = (output as any).messages;
         if (messages?.length) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.content) {
               console.log(`${clr.green}📜 Output:${clr.reset}\n${lastMsg.content}`);
            }
         }
      }
    }
  }