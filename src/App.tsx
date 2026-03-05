import './styles/app.css';
import { ProviderProvider } from './context/ProviderContext';
import { ChatProvider } from './context/ChatContext';
import { ModelProvider } from './context/ModelContext';
import { MemoryProvider } from './context/MemoryContext';
import { ExpertProvider } from './context/ExpertContext';
import { RoutineProvider } from './context/RoutineContext';
import { ToastProvider } from './context/ToastContext';
import AppLayout from './components/layout/AppLayout';
import ToastContainer from './components/ui/Toast';

function App() {
  return (
    <ToastProvider>
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
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
