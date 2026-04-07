import { of, map } from 'rxjs'; of(1).pipe(map(x=>x*2)).subscribe(console.log);
