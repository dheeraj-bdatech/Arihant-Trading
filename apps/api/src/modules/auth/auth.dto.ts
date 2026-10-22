import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { USER_ROLES } from '@arihant/shared';

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}

/** Demo persona sign-in (dev / opted-in QA builds only): the server picks the seeded account for the role. */
export class DemoLoginDto {
  @IsIn(USER_ROLES, { message: 'Unknown demo profile' })
  role!: string;
}
