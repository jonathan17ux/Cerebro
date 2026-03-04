import './styles/app.css';
import { ProviderProvider } from './context/ProviderContext';
import { ChatProvider } from './context/ChatContext';
import { ModelProvider } from './context/ModelContext';
import { MemoryProvider } from './context/MemoryContext';
import { ExpertProvider } from './context/ExpertContext';
import { RoutineProvider } from './context/RoutineContext';
import AppLayout from './components/layout/AppLayout';

function App() {
  return (
    <ProviderProvider>
      <ModelProvider>
        <MemoryProvider>
          <ExpertProvider>
            <RoutineProvider>
              <ChatProvider>
                <AppLayout />
              </ChatProvider>
            </RoutineProvider>
          </ExpertProvider>
        </MemoryProvider>
      </ModelProvider>
    </ProviderProvider>
  );
}

export default App;
