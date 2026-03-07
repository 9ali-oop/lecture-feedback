import { useParams } from 'react-router-dom';
import SessionReport from '../lecturer/SessionReport.tsx';
import { api } from '../../lib/api.ts';
import { useEffect, useState } from 'react';

export default function StudentSessionReport() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [moduleId, setModuleId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getSession(sessionId).then((s) => setModuleId(s.moduleId));
  }, [sessionId]);

  return <SessionReport backUrl={moduleId ? `/student/module/${moduleId}` : '/student'} />;
}
